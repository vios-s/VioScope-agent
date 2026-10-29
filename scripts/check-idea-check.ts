import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { stringify } from 'yaml';
import { closePostgresPools, createPostgresClient } from '../src/mastra/db/postgres';

const originalURL = process.env.DATABASE_URL!;
assert.ok(originalURL, 'DATABASE_URL is required.');
const source = createPostgresClient('theme-workflow-isolation');
const database = `vioscope_workflow_${randomUUID().replaceAll('-', '')}`;
const directory = await mkdtemp(join(tmpdir(), 'vioscope-workflow-'));
let created = false;
try {
  await source.pool.query(`CREATE DATABASE "${database}"`);
  created = true;
  const url = new URL(originalURL); url.pathname = `/${database}`;
  Object.assign(process.env, {
    DATABASE_URL: url.toString(), DATASTORE_DIR: directory, AUTH_SECRET: 'isolated-workflow-test',
    VIOSCOPE_RUNTIME_CONFIG_CACHE_PATH: join(directory, 'runtime.json'),
    THEME_MEETING_CONFIG_PATH: join(directory, 'config.yaml'),
    THEME_MEETING_UPDATES_PATH: join(directory, 'updates.yaml'),
    THEME_MEETING_NOTIFICATIONS_PATH: join(directory, 'notifications.yaml'),
    THEME_MEETING_CANCELLATIONS_PATH: join(directory, 'cancellations.yaml'),
  });
  const users = await import('../src/mastra/db/users');
  const schema = await import('../src/mastra/theme-meetings/schema');
  const route = await import('../app/api/idea-pitches/[pitchId]/route');
  const { createSessionToken, sessionCookieName } = await import('../src/mastra/auth/session');
  await users.ensureUsersTable();
  const db = createPostgresClient();
  for (const [username, role] of [['alice', 'member'], ['bob', 'member'], ['carol', 'member'], ['chair', 'organizer'], ['outsider', 'member'], ['principal', 'pi'], ['admincheck', 'administrator']]) {
    await db.pool.query(`INSERT INTO users(id,username,display_name,email,role,provisioning_status,source,password_reset_required)
      VALUES($1,$2,$2,$3,$4,'active','synthetic_workflow_check',false)`, [randomUUID(), username, `${username}@example.test`, role]);
  }
  const accounts = new Map(await Promise.all(['alice', 'bob', 'carol', 'chair', 'outsider', 'principal', 'admincheck'].map(async (name) => [name, (await users.getUserByUsername(name))!] as const)));
  const config = schema.themeMeetingConfigSchema.parse({
    timezone: 'Europe/London', cycle: { rotation: ['AB'], anchor_date: '2026-10-28' },
    themes: [
      { theme_id: 'A', title: 'Example A', cycle_group: 'AB', time: '10:00', coordinator: 'chair', coordinator_user: 'chair', members: ['alice', 'bob', 'carol'], member_users: ['alice', 'bob', 'carol'] },
      { theme_id: 'B', title: 'Example B', cycle_group: 'AB', time: '11:00', coordinator: 'outsider', coordinator_user: 'outsider', members: ['outsider'], member_users: ['outsider'] },
    ],
  });
  await writeFile(process.env.THEME_MEETING_CONFIG_PATH!, stringify(config));
  const projects = await import('../src/mastra/db/projects');
  const listRoute = await import('../app/api/idea-pitches/route');
  const { ideaDraftSchema, checkIdea, ideaReviewKeys } = await import('../src/mastra/projects/idea-check');
  const headers = (name: string) => ({ 'content-type': 'application/json', cookie: `${sessionCookieName}=${createSessionToken(accounts.get(name)!)}` });
  async function ok(response: Response) { assert.equal(response.status, 200, await response.clone().text()); return response.json(); }
  const directoryRoute = await import('../app/api/users/directory/route');
  assert.equal((await directoryRoute.GET(new Request('http://localhost/api/users/directory'))).status, 401);
  const directoryResult = await ok(await directoryRoute.GET(new Request('http://localhost/api/users/directory', { headers: headers('alice') })));
  assert.ok(directoryResult.users.some((user: { username: string }) => user.username === 'bob'));
  for (const user of directoryResult.users) assert.deepEqual(Object.keys(user).sort(), ['displayName', 'id', 'role', 'username'], 'Directory exposes only collaboration labels.');
  assert.equal((await projects.listProjectsForUser(accounts.get('principal')!)).length, 0);
  assert.equal((await listRoute.GET(new Request('http://localhost/pitches'))).status, 401);
  const pitch = await ok(await listRoute.POST(new Request('http://localhost/pitches', { method: 'POST', headers: headers('alice'), body: JSON.stringify({ title: 'Synthetic early idea' }) })));
  const context = { params: Promise.resolve({ pitchId: pitch.id }) };
  const get = (name: string) => route.GET(new Request('http://localhost/pitch', { headers: headers(name) }), context);
  const post = (name: string, command: Record<string, unknown>) => route.POST(new Request('http://localhost/pitch', { method: 'POST', headers: headers(name), body: JSON.stringify(command) }), context);
  assert.equal((await get('outsider')).status, 403);
  assert.equal((await get('admincheck')).status, 200, 'Administrator has full pitch access.');
  assert.equal((await get('chair')).status, 403, 'Theme coordination does not expose private pitches.');
  assert.equal((await ok(await get('alice'))).current, null);
  assert.equal((await ok(await listRoute.GET(new Request('http://localhost/pitches', { headers: headers('bob') })))).pitches.length, 0);
  assert.equal((await ok(await listRoute.GET(new Request('http://localhost/pitches', { headers: headers('principal') })))).pitches.length, 1);
  const legacy = { question: 'Legacy question', importance: 'Legacy importance', contribution: 'Legacy contribution', evidence: 'Legacy evidence', validation: 'Legacy validation', resources: 'Legacy resources', risks: 'Legacy risks', milestone: 'Legacy milestone' };
  const recovered = ideaDraftSchema.parse(legacy);
  for (const [key, value] of Object.entries(legacy)) assert.equal(recovered[key as keyof typeof legacy], value);
  assert.ok(recovered.why.includes('Legacy question') && recovered.context.includes('Legacy contribution'), 'Legacy sections are retained in their matching blocks.');
  const blanked = ideaDraftSchema.parse({ ...recovered, why: '' });
  assert.equal(blanked.why, '', 'An intentionally emptied block is not repopulated from legacy data.');
  const draft = ideaDraftSchema.parse({ question: 'Can the baseline generalize to a new setting?' });
  assert.equal(checkIdea(draft).filter(item => !item.present).length, 4);
  assert.equal((await post('bob', { operation: 'save', version: 0, draft })).status, 403);
  assert.equal((await post('alice', { operation: 'save', version: 0, title: '   ', draft })).status, 400, 'A blank title cannot be saved.');
  await ok(await post('alice', { operation: 'save', version: 0, draft }));
  const decision = { outcome: 'proceed', rationale: 'Initial comparison supports testing the claim.', nextMilestone: 'Alice runs a pilot by Friday.' };
  assert.equal((await post('alice', { operation: 'decide', version: 1, decision, confirmed: false })).status, 400);
  assert.equal((await post('alice', { operation: 'decide', version: 1, decision, confirmed: true })).status, 400);
  assert.equal((await post('alice', { operation: 'create_project', version: 1, confirmed: true })).status, 400);
  await ok(await post('alice', { operation: 'decide', version: 1, decision: { ...decision, outcome: 'revise' }, confirmed: true }));
  assert.equal((await projects.listProjectsForUser(accounts.get('principal')!)).length, 0, 'Pitch and revision decisions do not create projects.');
  const complete = { ...Object.fromEntries(Object.keys(draft).filter(key => key !== 'track').map(key => [key, `Recorded ${key}: synthetic reasoning and artifact reference.`])), track: 'A' };
  await ok(await post('alice', { operation: 'save', version: 2, draft: complete, source: { name: 'private-notes.txt', method: 'upload', text: 'PRIVATE_SOURCE_NOT_FOR_COLLABORATORS' } }));
  let saved = await ok(await get('alice'));
  assert.equal(saved.current.decision, null);
  assert.equal(saved.history[1].decision.outcome, 'revise');
  const results = await Promise.all(['alice', 'principal'].map(name => post(name, { operation: 'decide', version: 3, decision, confirmed: true })));
  assert.deepEqual(results.map(response => response.status).sort(), [200, 409]);
  saved = await ok(await get('alice'));
  assert.equal(saved.current.version, 4);
  assert.equal((await projects.listProjectsForUser(accounts.get('principal')!)).length, 0, 'Proceed is not automatic project creation.');
  await ok(await post('principal', { operation: 'decide', version: 4, decision: { ...decision, outcome: 'stop' }, confirmed: true }));
  assert.equal((await post('alice', { operation: 'create_project', version: 5, confirmed: true })).status, 400);
  await ok(await post('admincheck', { operation: 'decide', version: 5, decision, confirmed: true }));
  assert.equal((await post('alice', { operation: 'create_project', version: 6, confirmed: false })).status, 400);
  assert.equal((await post('alice', { operation: 'create_project', version: 4, confirmed: true })).status, 409);
  assert.equal((await post('bob', { operation: 'create_project', version: 6, confirmed: true })).status, 403);
  const ideaDb = await import('../src/mastra/db/idea-checks');
  const historyPitch = await ideaDb.createIdeaPitch('Synthetic version history', accounts.get('alice')!);
  await db.pool.query(`INSERT INTO idea_pitch_revisions(pitch_id,version,payload,by_username)
    SELECT $1, n, $2::jsonb, 'alice' FROM generate_series(1,22) n`, [historyPitch.id, JSON.stringify({ draft: complete, source: null, decision: null, operation: 'save' })]);
  assert.equal((await ideaDb.getIdeaCheck(historyPitch.id, accounts.get('alice')!)).history.length, 22, 'All versions remain accessible to the owner.');
  assert.equal((await ideaDb.getIdeaCheck(historyPitch.id, accounts.get('principal')!)).history.length, 22);

  const { validateIdeaReview } = await import('../src/mastra/projects/idea-review-schema');
  const currentDraft = (await ok(await get('alice'))).current.draft;
  const reviewBlock = { question: 'why', importance: 'why', contribution: 'context', evidence: 'why', validation: 'execution', resources: 'resourcePlan', risks: 'strategy', milestone: 'execution' } as const;
  const report = validateIdeaReview({ recommendation: 'needs_revision', summary: 'Synthetic evidence-backed review.', checks: ideaReviewKeys.map(field => ({ field, status: 'needs_work', assessment: 'More validation detail is needed.', evidence: [{ field: reviewBlock[field], quote: currentDraft[reviewBlock[field]] }], improvement: 'Define an observable next test.' })), nextSteps: ['Run a controlled pilot.'] }, currentDraft);
  const templateOnly = { ...currentDraft, resources: '', risks: '', milestone: '' };
  assert.doesNotThrow(() => validateIdeaReview(report, templateOnly), 'The five blocks support all review criteria.');
  assert.throws(() => validateIdeaReview({ ...report, checks: report.checks.map((check, i) => i ? check : { ...check, evidence: [{ field: 'why', quote: 'Invented supporting evidence' }] }) }, currentDraft));
  await ideaDb.saveIdeaReview(pitch.id, 6, { report, rules: 'synthetic rules', rulesHash: 'synthetic-hash', model: 'synthetic-model' }, accounts.get('alice')!);
  assert.equal((await ok(await get('alice'))).current.decision.outcome, 'proceed', 'AI advice cannot change the human decision.');
  assert.equal((await ok(await get('alice'))).reviews.length, 1);
  await assert.rejects(ideaDb.saveIdeaReview(pitch.id, 5, { report, rules: '', rulesHash: '', model: '' }, accounts.get('alice')!), /changed during review/);
  await ideaDb.saveIdeaReview(pitch.id, 6, { report, rules: 'Admin test rules', rulesHash: 'admin-test', model: 'synthetic-model' }, accounts.get('admincheck')!);
  const sharingRoute = await import('../app/api/idea-pitches/[pitchId]/collaborators/route');
  const share = (actor: string, username: string, action = 'add') => sharingRoute.POST(new Request('http://localhost/pitch/collaborators', { method: 'POST', headers: headers(actor), body: JSON.stringify({ username, action }) }), context);
  assert.equal((await share('bob', 'carol')).status, 403);
  await ok(await share('admincheck', 'bob'));
  assert.equal((await share('alice', 'unknown-user')).status, 400);
  await ok(await share('alice', 'bob'));
  const shared = await ok(await get('bob'));
  assert.equal(shared.canEdit, false); assert.equal(shared.canManage, false);
  assert.equal(shared.current.version, 6); assert.equal(shared.current.source, null);
  assert.deepEqual(shared.history, []); assert.deepEqual(shared.reviews, []); assert.deepEqual(shared.collaborators, []);
  assert.equal((await post('bob', { operation: 'save', version: 6, draft })).status, 403);
  assert.equal((await post('bob', { operation: 'create_project', version: 6, confirmed: true })).status, 403);
  assert.equal((await share('bob', 'carol')).status, 403);
  assert.equal((await route.DELETE(new Request('http://localhost/pitch', { method: 'DELETE', headers: headers('bob'), body: JSON.stringify({ version: 6, confirmed: true }) }), context)).status, 403);
  const sharedExport = await import('../app/api/idea-pitches/[pitchId]/export/route');
  assert.equal((await sharedExport.GET(new Request('http://localhost/export?format=txt&version=6', { headers: headers('bob') }), context)).status, 403);
  const bobList = await ok(await listRoute.GET(new Request('http://localhost/pitches', { headers: headers('bob') })));
  assert.equal(bobList.pitches.find((entry: { id: string }) => entry.id === pitch.id).access, 'shared');
  assert.equal((await ok(await listRoute.GET(new Request('http://localhost/pitches', { headers: headers('principal') })))).scope, 'all');
  const adminView = await ok(await get('admincheck'));
  assert.equal(adminView.canManage, true);
  assert.equal(adminView.history.length, 6);
  assert.equal(adminView.current.source.text, 'PRIVATE_SOURCE_NOT_FOR_COLLABORATORS');
  assert.equal((await ok(await listRoute.GET(new Request('http://localhost/pitches', { headers: headers('admincheck') })))).scope, 'all');
  await ok(await share('principal', 'bob', 'remove'));
  assert.equal((await get('bob')).status, 403);
  await db.pool.query("UPDATE users SET provisioning_status='disabled' WHERE username='carol'");
  assert.equal((await share('alice', 'carol')).status, 400);
  await db.pool.query("UPDATE users SET provisioning_status='active' WHERE username='carol'");
  // WEB_TEST_INSERT
  assert.equal((await post('alice', { operation: 'create_project', version: 6, confirmed: true, initialAction: { text: 'Run pilot', dueDate: '2026-02-30' } })).status, 400);
  const conversions = await Promise.all(['alice', 'admincheck'].map(async name => ok(await post(name, { operation: 'create_project', version: 6, confirmed: true, initialAction: { text: 'Run a synthetic pilot', dueDate: '2026-11-06' } }))));
  assert.equal(conversions[0].projectId, conversions[1].projectId, 'Concurrent conversion creates one project.');
  assert.deepEqual(conversions.map(item => item.created).sort(), [false, true]);
  const records = await projects.listProjectsForUser(accounts.get('principal')!);
  const projectWorkflow = await import('../src/mastra/db/project-workflow');
  const inheritedProfile = (await projectWorkflow.getProjectWorkflow(conversions[0].projectId, accounts.get('alice')!)).research.profile;
  assert.equal(inheritedProfile.question, currentDraft.why);
  assert.equal(inheritedProfile.claim, currentDraft.strategy);
  assert.equal(inheritedProfile.resourceNotes, currentDraft.resourcePlan);
  assert.equal(inheritedProfile.phase, 'initial_validation');
  assert.equal(records[0].target, decision.nextMilestone);
  assert.equal(records[0].todos.length, 1);
  assert.equal(records[0].todos[0].dueDate, '2026-11-06');
  const meetingRoute = await import('../app/api/theme-meetings/updates/route');
  const meetingPost = (name: string, extra: Record<string, unknown> = {}) => meetingRoute.POST(new Request('http://localhost/api/theme-meetings/updates', {
    method: 'POST', headers: headers(name), body: JSON.stringify({ meetingDate: '2099-11-04', themeId: 'A', member: name,
      updateType: 'deep_dive', progressText: 'The pilot is planned, not completed.', projectId: records[0].id, ...extra }),
  }));
  assert.equal((await meetingPost('outsider')).status, 400);
  assert.equal((await meetingPost('bob')).status, 400);
  const linked = await ok(await meetingPost('alice'));
  const snapshot = linked.update.project_context;
  assert.equal(snapshot.ownerUsername, 'alice');
  assert.equal(snapshot.stage, 1);
  const forged = await ok(await meetingPost('alice', { stage: 5, project_context: { stage: 5 } }));
  assert.equal(forged.update.project_context.stage, 1, 'Stage comes from the authorized project, never the request payload.');
  for (const updateType of ['milestone_check', 'strategic_slot']) assert.equal((await meetingPost('alice', { updateType })).status, 400);
  assert.equal(snapshot.actions[0].text, 'Run a synthetic pilot');
  assert.equal(snapshot.actions[0].dueDate, '2026-11-06');
  assert.equal(JSON.stringify(snapshot).includes('PRIVATE_SOURCE'), false);
  const agenda = linked.plan.meetings.find((meeting: { theme_id: string }) => meeting.theme_id === 'A');
  assert.deepEqual(agenda.agenda_items[0].project_context, snapshot);
  const { renderThemeMeetingAgendaEmail } = await import('../src/mastra/theme-meetings/agenda-email');
  const email = renderThemeMeetingAgendaEmail(linked.plan);
  assert.match(email.text, /Run a synthetic pilot/);
  assert.match(email.text, /Project stage: 1/);
  assert.match(email.html, /Project stage: 1/);
  assert.match(email.html, /2026-11-06/);
  const workflow = await import('../src/mastra/theme-meetings/workflow');
  const state = { confirmations: [], actions: [] };
  const confirmation = workflow.confirmAgenda(state, agenda, '2099-11-04', [{ username: 'alice', deferred: false, minutes: 10 }], 'chair');
  assert.deepEqual(confirmation.entries[0].project_context, snapshot, 'Confirmed agendas retain the shared project snapshot.');
  const {changeProjectWorkflow}=await import('../src/mastra/db/project-workflow');
  await changeProjectWorkflow(records[0].id,{operation:'task_update',confirmed:true,id:records[0].todos[0].id,revision:0,status:'done',note:'Completed the synthetic pilot.',evidenceIds:[]},accounts.get('alice')!);
  const { buildThemeMeetingPlan } = await import('../src/mastra/theme-meetings/planner');
  await projects.updateProject(records[0].id, { stage: 2 }, accounts.get('alice')!);
  const historical = await buildThemeMeetingPlan({ meetingDate: '2099-11-04' });
  assert.deepEqual(historical.plan.meetings[0].agenda_items[0].project_context, snapshot, 'Editing live tasks does not rewrite a submitted snapshot.');
  const refreshed = await ok(await meetingPost('alice'));
  assert.equal(refreshed.update.project_context.stage, 2, 'An explicit resubmission captures the new project stage.');
  assert.equal(confirmation.entries[0].project_context!.stage, 1, 'Confirmed stages remain immutable.');
  assert.deepEqual(refreshed.update.project_context.actions, [], 'Completed tasks leave the next submission.');
  const { submitThemeMeetingUpdateTool } = await import('../src/mastra/tools/theme-meetings');
  const chatResult = await submitThemeMeetingUpdateTool.execute!({ meetingDate: '2099-11-04', themeId: 'A', member: 'alice',
    updateType: 'short_update', progressText: 'Chat-linked synthetic update.', projectId: records[0].id },
    { requestContext: { get: (key: string) => key === 'vioscope-user' ? accounts.get('alice') : undefined } } as never);
  assert.ok(chatResult && 'update' in chatResult);
  assert.equal(chatResult.update.project_context!.stage, 2, 'Chat submissions inherit the same server-side stage.');
  assert.equal(chatResult.update.submitted_via, 'chat');
  const detached = await ok(await meetingPost('alice', { projectId: null }));
  assert.equal(detached.update.project_context, undefined, 'The project attachment is optional and removable.');
  const inherited = await ideaDb.getProjectIdeaOrigin(records[0].id, accounts.get('alice')!);
  assert.equal(inherited.version, 6); assert.deepEqual(inherited.draft, currentDraft);
  assert.equal(inherited.history, undefined); assert.equal(inherited.source, undefined); assert.equal(inherited.reviews, undefined);
  await projects.updateProject(records[0].id, { collaborators: ['bob'] }, accounts.get('principal')!);
  assert.deepEqual(await ideaDb.getProjectIdeaOrigin(records[0].id, accounts.get('bob')!), inherited, 'Collaborators receive only the final snapshot.');
  assert.equal((await meetingPost('bob')).status, 403, 'Project collaboration does not authorize claiming ownership in a meeting.');
  assert.equal((await get('bob')).status, 403, 'Project access does not reveal private pitch history.');
  assert.equal(records.length, 1); assert.equal(records[0].stage, 1); assert.equal(records[0].ownerUsername, 'alice');
  assert.equal((await ok(await get('alice'))).canEdit, false);
  assert.equal((await post('alice', { operation: 'save', version: 6, draft })).status, 400, 'Converted pitch retains its original approval.');
  assert.equal((await ok(await get('principal'))).history.length, 6);
  const exportRoute = await import('../app/api/idea-pitches/[pitchId]/export/route');
  const exportRequest = (name: string, version: number, format = 'txt', ctx = context) => exportRoute.GET(new Request(`http://localhost/pitch/export?version=${version}&format=${format}`, { headers: headers(name) }), ctx);
  assert.equal((await exportRequest('bob', 6)).status, 403);
  assert.equal((await exportRequest('admincheck', 6)).status, 200);
  assert.equal((await exportRequest('alice', 5)).status, 409);
  assert.equal((await exportRequest('alice', 6, 'exe')).status, 400);
  const exportResult = await exportRequest('principal', 6);
  assert.equal(exportResult.status, 200);
  assert.equal(exportResult.headers.get('Cache-Control'), 'private, no-store');
  const { approvedPitchDocument, exportApprovedPitch } = await import('../src/mastra/projects/idea-export');
  const approvedPayload = await ideaDb.getIdeaCheck(pitch.id, accounts.get('alice')!);
  const privatePayload = { ...approvedPayload, current: { ...approvedPayload.current!, source: { name: 'private-source.txt', method: 'upload' as const, text: 'DO_NOT_EXPORT_SOURCE' } }, history: [{ ...approvedPayload.current!, title: 'DO_NOT_EXPORT_HISTORY' }] };
  const projection = JSON.stringify(approvedPitchDocument(privatePayload, 6));
  assert.ok(!projection.includes('DO_NOT_EXPORT'));
  assert.equal(approvedPitchDocument(privatePayload, 6).sections.length, 8);
  const zip = await (await import('jszip')).default.loadAsync((await exportApprovedPitch(privatePayload, 6, 'docx')).body);
  const xml = await zip.file('word/document.xml')!.async('string');
  assert.ok(xml.includes('Human decision and evidence'));
  assert.ok(!xml.includes('DO_NOT_EXPORT'));
  const exportedText = await exportResult.text();
  assert.ok(exportedText.includes(decision.rationale));
  assert.ok(!exportedText.includes('Synthetic evidence-backed review'));
  assert.ok(!exportedText.includes('PRIVATE_SOURCE_NOT_FOR_COLLABORATORS'));
  const { defaultPitchExportFormat } = await import('../src/mastra/projects/idea-check');
  assert.equal(defaultPitchExportFormat('pitch.PDF'), 'pdf');
  assert.equal(defaultPitchExportFormat('pitch.docx'), 'docx');
  assert.equal(defaultPitchExportFormat('pitch.md'), 'md');
  assert.equal(defaultPitchExportFormat('pitch.pptx'), 'docx');
  const disposable = await ideaDb.createIdeaPitch('DEMO — Low-cost microscopy', accounts.get('alice')!);
  const disposableContext = { params: Promise.resolve({ pitchId: disposable.id }) };
  const remove = (name: string, version: number, confirmed = true, ctx = disposableContext) => route.DELETE(new Request('http://localhost/pitch', { method: 'DELETE', headers: headers(name), body: JSON.stringify({ version, confirmed }) }), ctx);
  await ideaDb.writeIdeaCheck(disposable.id, { operation: 'save', title: 'DEMO — Faster cell counting', version: 0, draft: currentDraft, source: null }, accounts.get('admincheck')!);
  assert.equal((await ideaDb.getIdeaCheck(disposable.id, accounts.get('alice')!)).pitch.title, 'DEMO — Faster cell counting');
  await ideaDb.writeIdeaCheck(disposable.id, { operation: 'save', title: 'DEMO — Cell counting pilot', version: 1, draft: currentDraft, source: null }, accounts.get('principal')!);
  const renamed = await ideaDb.getIdeaCheck(disposable.id, accounts.get('alice')!);
  assert.equal(renamed.pitch.title, 'DEMO — Cell counting pilot');
  assert.equal((await exportRequest('alice', 2, 'txt', disposableContext)).status, 400, 'Unapproved drafts cannot be exported as approved.');
  assert.equal(renamed.history[1].title, 'DEMO — Faster cell counting');
  await ideaDb.saveIdeaReview(disposable.id, 2, { report, rules: 'synthetic rules', rulesHash: 'synthetic-hash', model: 'synthetic-model' }, accounts.get('alice')!);
  assert.equal((await remove('bob', 2)).status, 403);
  assert.equal((await remove('outsider', 2)).status, 403);
  assert.equal((await remove('alice', 2, false)).status, 400);
  assert.equal((await remove('alice', 1)).status, 409);
  assert.equal((await remove('alice', 6, true, context)).status, 400, 'Converted pitches cannot be deleted.');
  await ok(await remove('admincheck', 2));
  assert.equal((await db.pool.query('SELECT * FROM idea_pitch_reviews WHERE pitch_id=$1', [disposable.id])).rowCount, 0);
  assert.equal((await db.pool.query('SELECT * FROM idea_pitch_revisions WHERE pitch_id=$1', [disposable.id])).rowCount, 0);
  await assert.rejects(ideaDb.getIdeaCheck(disposable.id, accounts.get('alice')!), /unavailable/);
  const blank = await ideaDb.createIdeaPitch('DEMO — Empty import draft', accounts.get('alice')!);
  await ok(await remove('alice', 0, true, { params: Promise.resolve({ pitchId: blank.id }) }));
  assert.equal((await ideaDb.getProjectIdeaOrigin(records[0].id, accounts.get('alice')!)).version, 6);
  if (process.env.CHECK_IDEA_UI === 'true') {
    const { checkIdeaPitchUi } = await import('./lib/idea-pitch-ui');
    await checkIdeaPitchUi(sessionCookieName, createSessionToken(accounts.get('alice')!), { collaborator: createSessionToken(accounts.get('bob')!), pi: createSessionToken(accounts.get('admincheck')!) });
  }
  await db.pool.query("UPDATE users SET provisioning_status='disabled' WHERE username='alice'");
  assert.equal((await get('alice')).status, 401);
  console.log('Idea pitch passed: independent pre-project drafts, private access, missing evidence, human decision, revision history, explicit conversion, stale/concurrent writes, exactly one project and read-only provenance. Synthetic data only.');
} finally {
  await closePostgresPools(process.env.DATABASE_URL);
  if (created) await source.pool.query(`DROP DATABASE "${database}" WITH (FORCE)`);
  await closePostgresPools(originalURL);
  await rm(directory, { recursive: true, force: true });
}
