import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { closePostgresPools, createPostgresClient, withDatabaseTransaction } from '../src/mastra/db/postgres';

const originalURL = process.env.DATABASE_URL!;
assert.ok(originalURL, 'DATABASE_URL is required to create the disposable test database.');
const source = createPostgresClient('hardening-test-maintenance');
const database = `vioscope_hardening_${randomUUID().replaceAll('-', '')}`;
const directory = await mkdtemp(join(tmpdir(), 'vioscope-hardening-'));
let created = false;
try {
  await source.pool.query(`CREATE DATABASE "${database}"`);
  created = true;
  const url = new URL(originalURL);
  url.pathname = '/' + database;
  Object.assign(process.env, {
    DATABASE_URL: url.toString(), DATASTORE_DIR: directory, AUTH_SECRET: randomUUID(),
    VIOSCOPE_RUNTIME_CONFIG_CACHE_PATH: join(directory, 'runtime.json'),
    EMAIL_NOTIFICATIONS_ENABLED: 'false', EMAIL_INBOX_ENABLED: 'false', EMAIL_DIGEST_ENABLED: 'false',
    THEME_MEETING_CONFIG_PATH: join(directory, 'config.yaml'),
    THEME_MEETING_UPDATES_PATH: join(directory, 'updates.yaml'),
    THEME_MEETING_NOTIFICATIONS_PATH: join(directory, 'notifications.yaml'),
    THEME_MEETING_CANCELLATIONS_PATH: join(directory, 'cancellations.yaml'),
    THEME_MEETING_EMAIL_DELIVERIES_PATH: join(directory, 'deliveries.yaml'),
  });
  const users = await import('../src/mastra/db/users');
  const projects = await import('../src/mastra/db/projects');
  const chat = await import('../src/mastra/db/chat');
  const auth = await import('../src/mastra/auth/session');
  const schema = await import('../src/mastra/theme-meetings/schema');
  const planner = await import('../src/mastra/theme-meetings/planner');
  const store = await import('../src/mastra/theme-meetings/store');
  const access = await import('../src/mastra/theme-meetings/access');
  await users.ensureUsersTable();
  await projects.ensureProjectTables();
  await chat.ensureChatTables();
  const db = createPostgresClient('hardening-test');
  for (const username of ['owner.check', 'outsider.check', 'coordinator.check', 'collaborator.check', 'pdra.check', 'pdra.second.check', 'pi.check', 'admin.check']) {
    await db.pool.query(`INSERT INTO users(id,username,display_name,email,role,provisioning_status,source,password_reset_required)
      VALUES($1,$2,$3,$4,'member','active','synthetic_hardening_check',false)`,
    [randomUUID(), username, `Synthetic ${username}`, `${username}@example.test`]);
  }
  let owner = (await users.getUserByUsername('owner.check'))!;
  let outsider = (await users.getUserByUsername('outsider.check'))!;
  await db.pool.query("UPDATE users SET role='pi' WHERE username='pi.check'");
  await db.pool.query("UPDATE users SET role='administrator' WHERE username='admin.check'");
  const coordinator = (await users.getUserByUsername('coordinator.check'))!;
  const config = schema.themeMeetingConfigSchema.parse({
    timezone: 'Europe/London', cycle: { rotation: ['CD'], anchor_date: '2026-10-21' },
    themes: [
      { theme_id: 'C', title: 'Synthetic C', cycle_group: 'CD', time: '10:00', coordinator: outsider.username,
        coordinator_user: owner.username, members: [outsider.username], member_users: [owner.username] },
      { theme_id: 'D', title: 'Synthetic D', cycle_group: 'CD', time: '11:00', coordinator: owner.displayName,
        coordinator_user: coordinator.username, members: [owner.displayName], member_users: [owner.username] },
    ],
  });
  await writeFile(process.env.THEME_MEETING_CONFIG_PATH!, stringify(config));
  const project = await projects.createProject({ project: 'hardening-project', piUsername: 'pi.check', pdraUsername: 'pdra.check', title: 'Synthetic private project', ownerUsername: owner.username }, owner);
  await assert.rejects(projects.getProjectForUser(project.id, outsider));
  outsider = await users.updateOwnUserProfile({ userId: outsider.id, displayName: owner.displayName, aliases: [owner.username] });
  assert.equal(auth.isUserName(owner.username, outsider), false);
  assert.equal(auth.isUserName(outsider.username.toUpperCase(), outsider), true);
  await assert.rejects(projects.getProjectForUser(project.id, outsider));
  await assert.rejects(projects.updateProject(project.id, { title: 'Unauthorized' }, outsider));
  assert.equal(access.canManageTheme(config, 'C', outsider), false, 'A display label matching a username does not grant coordinator access.');
  const plan = (await planner.buildThemeMeetingPlan({ meetingDate: '2030-01-02' })).plan;
  assert.ok(access.visiblePlanForUser(plan, config, outsider).meetings.every(m => m.theme_id !== 'C'));

  const request = (actor: typeof owner, path: string, body?: unknown) => new Request(`http://localhost${path}`, {
    method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', cookie: `${auth.sessionCookieName}=${auth.createSessionToken(actor)}` },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const projectList = await import('../app/api/projects/route');
  const projectDetail = await import('../app/api/projects/[projectId]/route');
  const projectWorkflow = await import('../app/api/projects/[projectId]/workflow/route');
  const projectContext = { params: Promise.resolve({ projectId: project.id }) };
  assert.equal(access.canManageTheme(config, 'D', coordinator), true, 'Fixture must be a real coordinator of the project owner.');
  await projects.updateProject(project.id, { collaborators: ['collaborator.check'], pdraUsernames: ['pdra.check', 'pdra.second.check'], pdraUsername: 'pdra.check' }, owner);
  for (const [username, allowed] of [
    ['owner.check', true], ['collaborator.check', true], ['pdra.check', true], ['pdra.second.check', true],
    ['pi.check', true], ['admin.check', true], ['coordinator.check', false], ['outsider.check', false],
  ] as const) {
    const actor = (await users.getUserByUsername(username))!;
    const response = await projectList.GET(request(actor, '/api/projects?includeArchived=true'));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).projects.some((item: { id: string }) => item.id === project.id), allowed, `${username}: project list`);
    for (const lookup of [project.id, project.project, project.title]) {
      const detail = await projectDetail.GET(request(actor, '/api/projects/' + encodeURIComponent(lookup)), { params: Promise.resolve({ projectId: lookup }) });
      assert.equal(detail.status, allowed ? 200 : 404, `${username}: direct lookup ${lookup}`);
    }
    const workflow = await projectWorkflow.GET(request(actor, `/api/projects/${project.id}/workflow`), projectContext);
    assert.equal(workflow.status, allowed ? 200 : 404, `${username}: workflow`);
  }
  // A coordinator still gets access through an explicit project relationship.
  await projects.updateProject(project.id, { collaborators: [coordinator.username] }, owner);
  assert.equal((await projects.getProjectForUser(project.id, coordinator)).access.reason, 'collaborator');
  await projects.updateProject(project.id, { collaborators: [], pdraUsernames: [coordinator.username], pdraUsername: coordinator.username }, owner);
  assert.equal((await projects.getProjectForUser(project.id, coordinator)).access.canEdit, false);
  await projects.updateProject(project.id, { pdraUsernames: [], pdraUsername: null }, owner);
  await assert.rejects(projects.getProjectForUser(project.id, coordinator));
  assert.equal((await projects.getProjectForUser(project.id, owner)).access.reason, 'owner', 'Owner access survives theme coordination.');
  console.log('Project visibility passed: owner, collaborators, all assigned PDRAs and PI/admin; coordinator-only access denied in list, direct lookups and workflow.');
  const updates = await import('../app/api/theme-meetings/updates/route');
  assert.equal((await updates.POST(request(outsider, '/api/theme-meetings/updates', {
    themeId: 'C', meetingDate: '2030-01-02', member: owner.username, updateType: 'short_update', progressText: 'Synthetic attempted impersonation.',
  }))).status, 403);
  const reviewRoute = await import('../app/api/review-runs/route');
  const reviewDetail = await import('../app/api/review-runs/[runId]/route');
  const saved = await reviewRoute.POST(request(owner, '/api/review-runs', {
    draftName: 'synthetic.md', checks: [{ skillName: 'test', skillLabel: 'Test', verdict: 'CONDITIONAL', reportMarkdown: '# Synthetic review', resultJson: { synthetic: true } }],
  }));
  assert.equal(saved.status, 200, await saved.clone().text());
  const run = (await saved.json()).run;
  assert.equal(run.initiator, owner.username);
  assert.equal(run.reviewer, owner.username);
  owner = await users.updateOwnUserProfile({ userId: owner.id, displayName: 'Renamed synthetic owner' });
  const context = { params: Promise.resolve({ runId: run.id }) };
  assert.equal((await reviewDetail.GET(request(owner, `/api/review-runs/${run.id}`), context)).status, 200);
  assert.equal((await reviewDetail.GET(request(outsider, `/api/review-runs/${run.id}`), context)).status, 403);

  await db.pool.query('CREATE TABLE hardening_transaction_probe(id INTEGER PRIMARY KEY)');
  await assert.rejects(withDatabaseTransaction(async () => {
    const other = createPostgresClient('another-helper');
    const first = (await db.pool.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal((await other.pool.query('SELECT pg_backend_pid() AS pid')).rows[0].pid, first);
    await db.pool.query('INSERT INTO hardening_transaction_probe VALUES(1)');
    await projects.addProjectUpdate(project.id, { text: 'Synthetic rolled back update.' }, owner);
    await chat.saveChatTurn({ sessionId: 'rolled-back-chat', actor: owner, userText: 'Synthetic', assistantText: 'Synthetic', assistantStatus: 'answer', sources: [] });
    throw new Error('Synthetic rollback');
  }), /Synthetic rollback/);
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM hardening_transaction_probe')).rows[0].n, 0);
  assert.equal((await projects.getProjectForUser(project.id, owner)).updates.length, 0);
  assert.equal((await db.pool.query("SELECT count(*)::int AS n FROM chat_sessions WHERE id='rolled-back-chat'")).rows[0].n, 0);
  await assert.rejects(withDatabaseTransaction(async () => {
    await db.pool.query('INSERT INTO hardening_transaction_probe VALUES(2)');
    await withDatabaseTransaction(async () => { throw new Error('Nested failure'); }).catch(() => undefined);
  }), /nested database operation failed/);
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM hardening_transaction_probe')).rows[0].n, 0);
  const backends = await Promise.all(Array.from({ length: 48 }, (_, n) => withDatabaseTransaction(async () => {
    await db.pool.query('INSERT INTO hardening_transaction_probe VALUES($1)', [n + 10]);
    return (await db.pool.query('SELECT pg_backend_pid() AS pid,pg_sleep(0.005)')).rows[0].pid as number;
  })));
  assert.ok(new Set(backends).size <= 8);
  assert.ok(db.pool.totalCount <= 8);
  assert.equal(db.pool, createPostgresClient('reused-helper').pool);
  await db.disconnect();
  await db.pool.query('SELECT 1');
  await Promise.all(Array.from({ length: 24 }, () => projects.getProjectForUser(project.id, owner)));
  await import('../src/mastra/tools/wiki-search');
  assert.equal((await source.pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=$1 AND application_name<>'vioscope-relational'", [database])).rows[0].n, 0,
    'Importing read-only tools must not open unused vector connections.');
  const { createWikiVectorStore } = await import('../src/mastra/vector');
  const vector = createWikiVectorStore();
  await vector.pool.query('SELECT 1');
  await vector.disconnect();

  const updatePath = join(directory, 'concurrent.yaml');
  await Promise.all(Array.from({ length: 16 }, (_, n) => store.saveThemeMeetingUpdate({
    meeting_date: '2030-01-02', theme_id: 'C', member: `synthetic-${n}`, member_username: `synthetic-${n}`,
    update_type: 'short_update', progress_text: 'Synthetic concurrent update.', questions: '', submitted_at: new Date().toISOString(), submitted_via: 'api',
  }, { updatesPath: updatePath })));
  assert.equal((await store.readThemeMeetingUpdates({ updatesPath: updatePath })).updates.length, 16);
  const crossProcessPath = join(directory, 'cross-process.yaml');
  const writers = Array.from({ length: 3 }, (_, worker) => {
    const program = `
      const { saveThemeMeetingUpdate } = await import('./src/mastra/theme-meetings/store.ts');
      const { closePostgresPools } = await import('./src/mastra/db/postgres.ts');
      process.stdout.write('ready\\n');
      await new Promise(resolve => process.stdin.once('data', resolve));
      for (let n = 0; n < 6; n++) await saveThemeMeetingUpdate({
        meeting_date:'2030-01-02', theme_id:'C', member:'worker-${worker}-'+n, member_username:'worker-${worker}-'+n,
        update_type:'short_update', progress_text:'Synthetic cross-process update.', questions:'',
        submitted_at:new Date().toISOString(), submitted_via:'api'
      }, { updatesPath: ${JSON.stringify(crossProcessPath)} });
      await closePostgresPools();
    `;
    const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', program], { stdio: ['pipe', 'pipe', 'pipe'] });
    let errors = '';
    child.stderr.on('data', data => { errors += data; });
    const timer = setTimeout(() => child.kill('SIGTERM'), 15000);
    const ready = new Promise<void>((resolve, reject) => {
      child.stdout.once('data', () => resolve());
      child.once('error', reject);
      child.once('exit', code => { if (code !== 0) reject(new Error(errors || 'Concurrent writer exited before ready.')); });
    });
    const done = new Promise<void>((resolve, reject) => child.once('exit', code => {
      clearTimeout(timer);
      code === 0 ? resolve() : reject(new Error(errors || `Concurrent writer exit ${code}`));
    }));
    void done.catch(() => undefined); // A startup failure may reject before the ready barrier.
    return { child, ready, done };
  });
  try {
    await Promise.all(writers.map(writer => writer.ready));
    for (const writer of writers) writer.child.stdin.end('go\n');
    await Promise.all(writers.map(writer => writer.done));
  } finally {
    for (const writer of writers) if (writer.child.exitCode === null) writer.child.kill('SIGTERM');
    await Promise.allSettled(writers.map(writer => writer.done));
  }
  assert.equal((await store.readThemeMeetingUpdates({ updatesPath: crossProcessPath })).updates.length, 18);
  await Promise.all(Array.from({ length: 12 }, (_, n) => store.saveThemeMeetingEmailDelivery({
    id: `receipt-${n}`, sent_at: new Date().toISOString(),
  })));
  assert.equal((await store.readThemeMeetingEmailDeliveries()).deliveries.length, 12);
  // A forced DROP must not be needed: wait for all shared sockets to leave the server first.
  await closePostgresPools(process.env.DATABASE_URL);
  const remaining = await source.pool.query('SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=$1', [database]);
  assert.equal(remaining.rows[0].n, 0);
  console.log(JSON.stringify({ accountImpersonation: 'blocked', reviewIdentitySurvivesRename: true,
    nestedProjectAndChatRollback: 'atomic', swallowedNestedFailure: 'rolled_back', parallelTransactions: backends.length,
    maxConnections: 8, concurrentProjectReads: 24, unusedVectorConnections: 0, vectorTeardown: 'drained', concurrentUpdatesSaved: 16, crossProcessUpdatesSaved: 18, concurrentReceiptsSaved: 12,
    connectionsBeforeDrop: 0, externalEmailsSent: 0 }));
} finally {
  await closePostgresPools(process.env.DATABASE_URL);
  if (created) await source.pool.query(`DROP DATABASE "${database}"`);
  await closePostgresPools(originalURL);
  await rm(directory, { recursive: true, force: true });
}
