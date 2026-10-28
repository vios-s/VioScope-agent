import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
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
  const planner = await import('../src/mastra/theme-meetings/planner');
  const workflow = await import('../src/mastra/theme-meetings/workflow');
  const route = await import('../app/api/theme-meetings/workflow/route');
  const { createSessionToken, sessionCookieName } = await import('../src/mastra/auth/session');
  await users.ensureUsersTable();
  const db = createPostgresClient();
  for (const [username, role] of [['alice', 'member'], ['bob', 'member'], ['carol', 'member'], ['chair', 'organizer'], ['outsider', 'member'], ['principal', 'pi']]) {
    await db.pool.query(`INSERT INTO users(id,username,display_name,email,role,provisioning_status,source,password_reset_required)
      VALUES($1,$2,$2,$3,$4,'active','synthetic_workflow_check',false)`, [randomUUID(), username, `${username}@example.test`, role]);
  }
  const accounts = new Map(await Promise.all(['alice', 'bob', 'carol', 'chair', 'outsider', 'principal'].map(async (name) => [name, (await users.getUserByUsername(name))!] as const)));
  const config = schema.themeMeetingConfigSchema.parse({
    timezone: 'Europe/London', cycle: { rotation: ['AB'], anchor_date: '2026-10-28' },
    themes: [
      { theme_id: 'A', title: 'Example A', cycle_group: 'AB', time: '10:00', coordinator: 'chair', coordinator_user: 'chair', members: ['alice', 'bob', 'carol'], member_users: ['alice', 'bob', 'carol'] },
      { theme_id: 'B', title: 'Example B', cycle_group: 'AB', time: '11:00', coordinator: 'outsider', coordinator_user: 'outsider', members: ['outsider'], member_users: ['outsider'] },
    ],
  });
  await writeFile(process.env.THEME_MEETING_CONFIG_PATH!, stringify(config));
  const date = '2026-10-28';
  for (const name of ['alice', 'bob', 'carol']) await planner.submitThemeMeetingUpdate({ meetingDate: date, themeId: 'A', member: name, updateType: 'deep_dive', progressText: `${name} original evidence.`, now: new Date('2026-10-27T12:00:00Z') });
  const headers = (name: string) => ({ 'content-type': 'application/json', cookie: `${sessionCookieName}=${createSessionToken(accounts.get(name)!)}` });
  const get = (name: string, meetingDate = date, themeId = 'A') => route.GET(new Request(`http://localhost/api/theme-meetings/workflow?${new URLSearchParams({ meetingDate, themeId })}`, { headers: headers(name) }));
  const post = (name: string, body: Record<string, unknown>) => route.POST(new Request('http://localhost/api/theme-meetings/workflow', {
    method: 'POST', headers: headers(name), body: JSON.stringify({ meetingDate: date, themeId: 'A', ...body }),
  }));
  async function ok(response: Response) { assert.equal(response.status, 200, await response.clone().text()); return response.json(); }
  assert.equal((await route.GET(new Request(`http://localhost/api/theme-meetings/workflow?meetingDate=${date}&themeId=A`))).status, 401);
  assert.equal((await get('outsider')).status, 403, 'Other-theme coordinator cannot read A.');
  let draft = await ok(await get('chair'));
  const entries = draft.candidates.map((item: { member_username: string }) => ({ username: item.member_username, minutes: 30, deferred: false }));
  assert.equal((await post('alice', { operation: 'confirm', sourceVersion: draft.sourceVersion, entries })).status, 403);
  assert.equal((await post('chair', { operation: 'confirm', sourceVersion: draft.sourceVersion, entries })).status, 400, 'Reject overbooking.');
  entries[2].deferred = true;
  entries.reverse();
  await ok(await post('chair', { operation: 'confirm', sourceVersion: draft.sourceVersion, entries }));
  assert.equal((await post('chair', { operation: 'confirm', sourceVersion: draft.sourceVersion, entries })).status, 409, 'Reject stale confirmation.');
  let saved = await ok(await get('chair'));
  assert.equal(saved.confirmation.version, 1);
  assert.equal(saved.confirmation.confirmedBy, 'chair');
  assert.deepEqual(saved.confirmation.entries.map((item: { member_username: string }) => item.member_username), ['carol', 'bob', 'alice']);
  const confirmed = (await planner.buildThemeMeetingPlan({ meetingDate: date })).plan;
  assert.deepEqual(confirmed.meetings[0].agenda_items.map((item) => item.member_username), ['bob', 'alice']);
  const { notificationStateForUser } = await import('../src/mastra/theme-meetings/notification-state');
  const reminder = schema.themeMeetingNotificationSchema.parse({ id: 'deferred-reminder', action: 'first_reminder', meeting_date: date,
    cycle_group: 'AB', theme_id: 'A', member: 'carol', member_username: 'carol', title: 'Update', body: 'Update', created_at: new Date().toISOString() });
  assert.equal(notificationStateForUser([reminder], confirmed, accounts.get('carol')!, new Set())[0].completed, true,
    'Deferring a submitted slot must not reopen its progress reminder.');
  await assert.rejects(planner.submitThemeMeetingUpdate({ meetingDate: date, themeId: 'A', member: 'alice', updateType: 'short_update', progressText: 'New late evidence.', now: new Date('2026-10-28T09:00:00Z') }), /locked after/, 'Preserve the existing cutoff enforcement.');
  await planner.submitThemeMeetingUpdate({ meetingDate: date, themeId: 'A', member: 'alice', updateType: 'short_update', progressText: 'Updated evidence before cutoff.', now: new Date('2026-10-28T07:00:00Z') });
  assert.equal((await planner.buildThemeMeetingPlan({ meetingDate: date })).plan.meetings[0].agenda_items.at(-1)!.progress_text, 'alice original evidence.', 'Later updates cannot mutate a confirmed snapshot.');
  draft = await ok(await get('chair'));
  assert.equal(draft.candidates.find((item: { member_username: string }) => item.member_username === 'alice').progress_text, 'Updated evidence before cutoff.');
  const next = draft.candidates.map((item: { member_username: string; duration_minutes: number }) => ({ username: item.member_username, minutes: item.duration_minutes, deferred: item.member_username === 'carol' }));
  const concurrent = await Promise.all([post('chair', { operation: 'confirm', sourceVersion: draft.sourceVersion, entries: next }), post('principal', { operation: 'confirm', sourceVersion: draft.sourceVersion, entries: next })]);
  assert.deepEqual(concurrent.map((response) => response.status).sort(), [200, 409]);
  assert.equal((await workflow.readMeetingWorkflow()).confirmations.length, 2, 'Preserve previous versions.');
  const action = { decision: 'Proceed with the baseline check.', task: 'Run the baseline and attach results.', owner: 'alice', dueDate: '2026-10-30' };
  assert.equal((await post('alice', { operation: 'add_action', action })).status, 403);
  assert.equal((await post('chair', { operation: 'add_action', action: { ...action, owner: 'outsider' } })).status, 400);
  await ok(await post('chair', { operation: 'add_action', action }));
  saved = await ok(await get('chair'));
  const item = saved.actions[0];
  assert.equal((await ok(await get('bob'))).actions.length, 0, 'Member cannot see someone else’s actions.');
  const update = { operation: 'update_action', id: item.id, version: item.version, status: 'done', note: 'Baseline results: artifact/example.' };
  assert.equal((await post('bob', update)).status, 403);
  assert.equal((await post('alice', { ...update, note: '' })).status, 400);
  await ok(await post('alice', update));
  assert.equal((await post('alice', update)).status, 409, 'Reject stale action edits.');
  const completed = (await ok(await get('alice'))).actions[0];
  assert.equal(completed.status, 'done'); assert.equal(completed.history.length, 2);
  assert.equal(completed.history[1].by, 'alice');
  await ok(await post('chair', { ...update, version: completed.version, status: 'open', note: 'Repeat with another seed.' }));
  assert.equal((await ok(await get('chair', '2026-11-04'))).actions[0].status, 'open', 'Carry unfinished work to the next meeting.');
  assert.equal((await ok(await get('alice'))).confirmation.entries.length, 1, 'Preserve existing agenda privacy.');
  // Optional project links share only the selected action with authorized project viewers.
  const projects = await import('../src/mastra/db/projects');
  const projectRoute = await import('../app/api/projects/[projectId]/meeting-actions/route');
  const project = await projects.createProject({ title: 'Linked synthetic project', ownerUsername: 'principal', collaborators: ['alice', 'chair', 'outsider'], stage: 2 }, accounts.get('principal')!);
  const projectGet = (name: string) => projectRoute.GET(new Request('http://localhost/api/projects/actions', { headers: headers(name) }), { params: Promise.resolve({ projectId: project.id }) });
  assert.equal((await projectRoute.GET(new Request('http://localhost/api/projects/actions'), { params: Promise.resolve({ projectId: project.id }) })).status, 401);
  assert.equal((await ok(await projectGet('outsider'))).actions.length, 0, 'Unlinked group actions stay out of projects.');
  assert.equal((await post('chair', { operation: 'add_action', action: { ...action, owner: 'bob', projectId: project.id } })).status, 400, 'Assignment does not grant project access.');
  const privateProject = await projects.createProject({ title: 'Private synthetic project', ownerUsername: 'outsider' }, accounts.get('principal')!);
  assert.equal((await post('chair', { operation: 'add_action', action: { ...action, projectId: privateProject.id } })).status, 400, 'Theme management does not grant project access.');
  await ok(await post('chair', { operation: 'add_action', action: { ...action, projectId: project.id } }));
  const linked = (await ok(await projectGet('outsider'))).actions[0];
  assert.equal(linked.projectId, project.id);
  assert.equal(linked.owner, 'alice');
  assert.equal((await projectGet('bob')).status, 404, 'Unrelated users cannot read linked records.');
  assert.equal((await projects.getProjectForUser(project.id, accounts.get('alice')!)).stage, 2, 'Linking does not advance the project.');
  const linkedView = (await ok(await get('alice'))).actions.find((item: { id: string }) => item.id === linked.id);
  await ok(await post('alice', { operation: 'update_action', id: linked.id, version: linkedView.version, status: 'done', note: 'Shared completion evidence.' }));
  assert.equal((await ok(await projectGet('outsider'))).actions[0].status, 'done', 'Both views use the same record.');
  await projects.updateProject(project.id, { collaborators: [] }, accounts.get('principal')!);
  assert.equal((await projectGet('outsider')).status, 404, 'Revoking project access revokes meeting record access.');
  assert.equal((await ok(await get('chair'))).actions.some((item: { id: string }) => item.id === linked.id), false, 'Theme manager cannot bypass project permissions.');
  assert.equal((await post('chair', { operation: 'update_action', id: linked.id, version: linkedView.version, status: 'open', note: 'Denied' })).status, 400);
  const legacy = workflow.workflowSchema.parse({ confirmations: [], actions: [{ ...item, projectId: undefined }] });
  assert.equal(legacy.actions[0].projectId, null, 'Existing records remain unlinked.');
  const before = await readFile(workflow.workflowPath(), 'utf8');
  await db.pool.query("UPDATE users SET provisioning_status='disabled' WHERE username='alice'");
  assert.equal((await get('alice')).status, 401);
  assert.equal((await post('chair', { operation: 'add_action', action })).status, 400);
  assert.equal(await readFile(workflow.workflowPath(), 'utf8'), before, 'Rejected writes leave the file unchanged.');
  console.log('Theme workflow passed: saved versions, order/defer/budget, late edits, concurrent confirmation, exact account access, assigned actions, evidence, stale-write rejection and next-meeting follow-up. Synthetic data only.');
} finally {
  await closePostgresPools(process.env.DATABASE_URL);
  if (created) await source.pool.query(`DROP DATABASE "${database}" WITH (FORCE)`);
  await closePostgresPools(originalURL);
  await rm(directory, { recursive: true, force: true });
}
