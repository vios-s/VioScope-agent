import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { stringify } from 'yaml';
import { closePostgresPools, createPostgresClient } from '../src/mastra/db/postgres';
import { getFreePort, startNextServer, stopServer, waitForServer } from './lib/playwright-smoke';

const originalURL = process.env.DATABASE_URL!;
assert.ok(originalURL, 'DATABASE_URL is required for disposable database creation.');
const source = createPostgresClient('issue-check-isolation');
const name = `vioscope_issue_test_${randomUUID().replaceAll('-', '')}`;
const dir = await mkdtemp(join(tmpdir(), 'vioscope-issue-fixes-'));
const distDir = `.local/checks/issue-next-${name}`;
let created = false;
let server: ReturnType<typeof startNextServer> | null = null;
const generatedFiles = new Map<string, Buffer>();
try {
  await source.pool.query(`CREATE DATABASE "${name}"`);
  created = true;
  const url = new URL(originalURL);
  url.pathname = '/' + name;
  Object.assign(process.env, {
    DATABASE_URL: url.toString(), DATASTORE_DIR: dir,
    VIOSCOPE_RUNTIME_CONFIG_CACHE_PATH: join(dir, 'runtime.json'),
    THEME_MEETING_CONFIG_PATH: join(dir, 'config.yaml'),
    THEME_MEETING_UPDATES_PATH: join(dir, 'updates.yaml'),
    THEME_MEETING_NOTIFICATIONS_PATH: join(dir, 'notifications.yaml'),
    THEME_MEETING_CANCELLATIONS_PATH: join(dir, 'cancellations.yaml'),
    PROJECT_ARTIFACT_UPLOAD_DIR: join(dir, 'artifacts'),
    EMAIL_NOTIFICATIONS_ENABLED: 'false', EMAIL_INBOX_ENABLED: 'false', EMAIL_DIGEST_ENABLED: 'false',
    AUTH_SECRET: randomUUID(),
  });
  const users = await import('../src/mastra/db/users');
  const { createSessionToken, sessionCookieName } = await import('../src/mastra/auth/session');
  const planner = await import('../src/mastra/theme-meetings/planner');
  const store = await import('../src/mastra/theme-meetings/store');
  const projects = await import('../src/mastra/db/projects');
  const readState = await import('../src/mastra/db/theme-notifications');
  const meetingDate = planner.upcomingWednesday();
  const password = 'SyntheticIssueCheck1!';
  await users.ensureUsersTable();
  for (const [username, role] of [['alice', 'member'], ['bob', 'member'], ['admin', 'administrator'], ['charlie', 'member']] as const) {
    await users.upsertLocalUser({ username, displayName: `Synthetic ${username}`, email: `${username}@example.test`, password, role, passwordResetRequired: false, source: 'synthetic_issue_check' });
  }
  const alice = (await users.getUserByUsername('alice'))!;
  const bob = (await users.getUserByUsername('bob'))!;
  const admin = (await users.getUserByUsername('admin'))!;
  const charlie = (await users.getUserByUsername('charlie'))!;
  const config = {
    timezone: 'Europe/London', cycle: { rotation: ['AB'], anchor_date: meetingDate },
    pi_users: [], administrator_user: 'admin',
    themes: [{ theme_id: 'A', title: 'Synthetic theme', cycle_group: 'AB', time: '10:00', coordinator: 'Synthetic admin', coordinator_user: 'admin', members: ['Synthetic alice', 'Synthetic bob'], member_users: ['alice', 'bob'] }],
  };
  await writeFile(process.env.THEME_MEETING_CONFIG_PATH!, stringify(config));
  await writeFile(process.env.THEME_MEETING_UPDATES_PATH!, stringify({ updates: [] }));
  const notification = (id: string, username: string, action = 'first_reminder') => ({
    id, meeting_date: meetingDate, cycle_group: 'AB', theme_id: 'A', member: `Synthetic ${username}`, member_username: username,
    action, title: `Synthetic meeting reminder ${id}`, body: 'Synthetic full reminder detail.\nPlease submit the missing project update.\nFinal line visible only in details.', created_at: new Date().toISOString(), read: false,
  });
  const notifications = [notification('alice-first', 'alice'), notification('alice-gentle', 'alice', 'gentle_missing_update_reminder'), notification('bob-first', 'bob')];
  await writeFile(process.env.THEME_MEETING_NOTIFICATIONS_PATH!, stringify({ notifications }));
  const meetingRoute = await import('../app/api/theme-meetings/route');
  const notificationRoute = await import('../app/api/theme-meetings/notifications/route');
  const updateRoute = await import('../app/api/theme-meetings/updates/route');
  const deletionRoute = await import('../app/api/project-updates/[updateId]/route');
  function request(path: string, actor: typeof alice, body?: unknown, method = body === undefined ? 'GET' : 'PATCH') {
    return new Request(`http://localhost${path}`, { method, headers: { cookie: `${sessionCookieName}=${createSessionToken(actor)}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  }
  async function payload(actor: typeof alice) {
    const response = await meetingRoute.GET(request(`/api/theme-meetings?date=${meetingDate}`, actor));
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  }
  let current = await payload(alice);
  assert.equal(current.notifications.filter((n: { read: boolean }) => !n.read).length, 2);
  assert.equal((await notificationRoute.PATCH(request('/api/theme-meetings/notifications', bob, { notificationId: 'alice-first' }))).status, 404);
  assert.equal((await notificationRoute.PATCH(request('/api/theme-meetings/notifications', alice, { notificationId: 'alice-first' }))).status, 200);
  assert.equal((await payload(alice)).notifications.filter((n: { read: boolean }) => !n.read).length, 1);
  assert.equal((await payload(admin)).notifications.filter((n: { read: boolean }) => !n.read).length, 3, 'One reader does not mark another reader’s events read.');
  assert.ok(!(await readState.readThemeNotificationIds(bob.id)).has('alice-first'));
  assert.equal((await notificationRoute.PATCH(request('/api/theme-meetings/notifications', alice, { all: true, meetingDate }))).status, 200);
  assert.equal((await payload(alice)).notifications.filter((n: { read: boolean }) => !n.read).length, 0);

  await store.saveThemeMeetingUpdate({ meeting_date: meetingDate, theme_id: 'A', member: alice.displayName, member_username: alice.username, update_type: 'short_update', progress_text: 'Synthetic progress.', questions: '', submitted_at: new Date().toISOString(), submitted_via: 'api' });
  current = await payload(alice);
  assert.ok(current.notifications.every((n: { completed?: boolean; read: boolean }) => n.completed && n.read));
  assert.ok((await payload(admin)).notifications.every((n: { completed?: boolean }) => !n.completed), 'Only the reminder recipient’s own submission completes the reminder.');
  const cutoffs = [...notifications, notification('alice-agenda', 'alice', 'agenda_cutoff')];
  await writeFile(process.env.THEME_MEETING_NOTIFICATIONS_PATH!, stringify({ notifications: cutoffs }));
  assert.equal((await payload(alice)).notifications.find((n: { id: string }) => n.id === 'alice-agenda').completed, false);

  for (const [body, message] of [
    [{ member: 'alice', updateType: 'short_update' }, 'Choose a theme before submitting.'],
    [{ themeId: 'A', updateType: 'short_update' }, 'Choose a member before submitting.'],
    [{ themeId: 'A', member: 'alice', updateType: 'unknown' }, 'Choose a valid slot type before submitting.'],
    [{ themeId: 'A', member: 'alice', updateType: 'short_update', progressText: '' }, 'Add a short progress update before submitting.'],
  ] as const) {
    const response = await updateRoute.POST(request('/api/theme-meetings/updates', alice, body, 'POST'));
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, message);
  }
  let project = await projects.createProject({ project: 'synthetic-issue-project', title: 'Synthetic issue project', ownerUsername: 'alice', collaborators: ['bob', 'Synthetic charlie'], track: 'A', stage: 1 }, alice);
  project = await projects.addProjectUpdate(project.id, { type: 'progress', text: 'Synthetic update to delete.', artifact: { title: 'Synthetic attachment', kind: 'other', path: 'synthetic.txt' } }, alice);
  const collaborative = await projects.getProjectForUser(project.id, bob);
  assert.equal(collaborative.access.reason, 'collaborator');
  assert.equal(collaborative.access.canComment, true);
  assert.equal(collaborative.access.canEdit, false);
  assert.equal(collaborative.access.canArchive, false);
  assert.equal(collaborative.access.canAddUpdate, false);
  assert.ok((await projects.listProjectsForUser(bob)).some((p) => p.id === project.id));
  assert.equal((await projects.getProjectArtifactForUser(project.artifacts[0]!.id, bob)).project.id, project.id);
  await assert.rejects(() => projects.getProjectForUser(project.id, charlie), 'An external display-name label does not grant access.');
  await assert.rejects(() => projects.getProjectForUser(project.id, { ...bob, provisioningStatus: 'disabled' }));
  await assert.rejects(() => projects.updateProject(project.id, { title: 'Unauthorized edit' }, bob));
  await assert.rejects(() => projects.archiveProject(project.id, bob));
  await assert.rejects(() => projects.addProjectUpdate(project.id, { type: 'progress', text: 'Unauthorized update' }, bob));
  const commented = await projects.addProjectUpdateComment(project.updates[0]!.id, 'Synthetic collaborator comment.', bob);
  assert.ok(commented.updates[0]!.comments.some((c) => c.byUsername === 'bob'));
  await projects.updateProject(project.id, { collaborators: [] }, alice);
  await assert.rejects(() => projects.getProjectForUser(project.id, bob), 'Removing a collaborator revokes access.');
  await projects.updateProject(project.id, { collaborators: ['bob', 'Synthetic charlie'] }, alice);
  const updateId = project.updates[0]!.id;
  const artifactId = project.artifacts[0]!.id;
  const context = { params: Promise.resolve({ updateId }) };
  assert.notEqual((await deletionRoute.DELETE(request(`/api/project-updates/${updateId}`, bob, undefined, 'DELETE'), context)).status, 200);
  assert.equal((await projects.getProjectForUser(project.id, alice)).updates.length, 1);
  assert.equal((await deletionRoute.DELETE(request(`/api/project-updates/${updateId}`, alice, undefined, 'DELETE'), context)).status, 200);
  project = await projects.getProjectForUser(project.id, alice);
  assert.equal(project.updates.length, 0);
  assert.equal(project.artifacts.length, 0);
  await assert.rejects(() => projects.getProjectArtifactForUser(artifactId, alice));
  console.log('Issue API checks passed: per-user read state, unread counts, completion, collaborator read/comment boundaries, readable validation and confirmed update deletion.');

  if (process.argv.includes('--serve')) {
    // Reset only synthetic test records for interactive browser validation.
    await writeFile(process.env.THEME_MEETING_UPDATES_PATH!, stringify({ updates: [] }));
    await writeFile(process.env.THEME_MEETING_NOTIFICATIONS_PATH!, stringify({ notifications }));
    const reset = createPostgresClient('issue-ui-reset');
    try { await reset.pool.query('DELETE FROM theme_notification_reads'); } finally { await reset.disconnect(); }
    project = await projects.addProjectUpdate(project.id, { type: 'progress', text: 'Synthetic browser deletion example.' }, alice);
    for (const file of ['next-env.d.ts', 'tsconfig.json']) generatedFiles.set(file, await readFile(file));
    const port = await getFreePort();
    server = startNextServer({ port, env: { VIOSCOPE_NEXT_DIST_DIR: distDir, NODE_ENV: 'development' } });
    await waitForServer(server, `http://127.0.0.1:${port}`, 200);
    console.log(`UI_CHECK_READY http://127.0.0.1:${port} username=alice password=${password}`);
    await new Promise<void>((done) => { process.once('SIGINT', done); process.once('SIGTERM', done); });
  }
} finally {
  await stopServer(server);
  for (const [file, original] of generatedFiles) {
    if ((await readFile(file, 'utf8')).includes(distDir)) await writeFile(file, original);
  }
  await closePostgresPools(process.env.DATABASE_URL);
  if (created) await source.pool.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  await source.disconnect();
  await rm(dir, { recursive: true, force: true });
  await rm(resolve(distDir), { recursive: true, force: true });
}
process.exit(0);
