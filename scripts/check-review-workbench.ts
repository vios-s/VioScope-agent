import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, copyFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { createPostgresClient, closePostgresPools } from '../src/mastra/db/postgres';
import { chromium, getFreePort, startNextServer, waitForServer, stopServer, dismissWelcomeIfVisible } from './lib/playwright-smoke';

const root = process.cwd();
const original = process.env.DATABASE_URL!;
const source = createPostgresClient('review-regression-isolation');
const database = 'review_test_' + randomUUID().replaceAll('-', '');
const directory = await mkdtemp(join(tmpdir(), 'vioscope-review-'));
let created = false;
let server: ReturnType<typeof startNextServer> | null = null;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const result = {
  report: '# Synthetic review', draftName: 'test-draft.txt', draftChars: 2000,
  draftTruncated: false, finishReason: 'stop',
  structured: { verdict: 'CONDITIONAL', summary: 'Synthetic regression result',
    appliedSkills: [], findings: [], reasonsToReject: [], checkmateQuestions: [], mitigations: [],
    humanSignOff: { leadPdra: 'pending', piOrOrganizer: 'pending', remainingEvidenceNeeded: [] }, perSkillNotes: [] },
};
try {
  await source.pool.query(`CREATE DATABASE "${database}"`);
  created = true;
  const url = new URL(original); url.pathname = '/' + database;
  Object.assign(process.env, {
    DATABASE_URL: url.toString(), DATASTORE_DIR: directory, AUTH_SECRET: 'isolated-review-regression',
    VIOSCOPE_RUNTIME_CONFIG_CACHE_PATH: join(directory, 'runtime.json'),
    THEME_MEETING_CONFIG_PATH: join(directory, 'themes.yaml'),
    THEME_MEETING_UPDATES_PATH: join(directory, 'updates.yaml'),
    EMAIL_NOTIFICATIONS_ENABLED: 'false',
  });
  const users = await import('../src/mastra/db/users');
  await users.ensureUsersTable();
  const db = createPostgresClient();
  for (const [username, role] of [['review_owner', 'member'], ['review_other', 'member'], ['review_admin', 'administrator']]) {
    await db.pool.query(`INSERT INTO users(id,username,display_name,email,role,provisioning_status,password_reset_required)
      VALUES($1,$2,$3,$4,$5,'active',false)`, [randomUUID(), username, username, username + '@example.test', role]);
  }
  const { saveReviewRun } = await import('../src/mastra/db/review-runs');
  async function seed(name: string, initiator: string, extra = {}) {
    return saveReviewRun({ projectName: name, draftName: name + '.txt', initiator, ...extra,
      checks: [{ skillName: 'vios-pdra-meta-review', skillLabel: 'PDRA', verdict: 'CONDITIONAL',
        reportMarkdown: result.report, resultJson: result, signoffStatus: 'pending' }] });
  }
  const own = await seed('Own older review', ' REVIEW_OWNER ');
  const shared = await seed('Shared older review', 'review_other', { cooperators: [' REVIEW_OWNER '] });
  const assigned = await seed('Assigned older review', 'review_other', { reviewer: ' REVIEW_OWNER ' });
  for (let index = 0; index < 10; index++) await seed('Other review ' + index, 'review_other');

  // A separate source copy keeps Next's generated files away from the deployed runtime.
  const runtime = join(directory, 'app');
  for (const file of execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).trim().split('\n')) {
    const destination = join(runtime, file);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(join(root, file), destination);
  }
  execFileSync('cp', ['-aL', '--reflink=auto', resolve(root, 'node_modules'), join(runtime, 'node_modules')]);
  process.chdir(runtime);
  const port = await getFreePort(), base = `http://127.0.0.1:${port}`;
  server = startNextServer({ port, mode: 'dev', env: { ...process.env } });
  await waitForServer(server, base, 480);
  browser = await chromium.launch();
  const { createSessionToken, sessionCookieName } = await import('../src/mastra/auth/session');
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addCookies([{ name: sessionCookieName, value: createSessionToken((await users.getUserByUsername('review_owner'))!), url: base }]);
  const historyResponse = await context.request.get(base + '/api/review-runs?limit=8');
  assert.equal(historyResponse.status(), 200);
  const history = (await historyResponse.json()).runs;
  assert.deepEqual(new Set(history.map((run: any) => run.id)), new Set([own.id, shared.id, assigned.id]));
  const limited = await context.request.get(base + '/api/review-runs?limit=1');
  assert.equal((await limited.json()).runs.length, 1);
  const adminContext = await browser.newContext();
  await adminContext.addCookies([{ name: sessionCookieName, value: createSessionToken((await users.getUserByUsername('review_admin'))!), url: base }]);
  const adminHistory = await adminContext.request.get(base + '/api/review-runs?limit=8');
  assert.equal((await adminHistory.json()).runs.length, 8);
  console.log('PASS: permission filtering precedes limit, including collaborator/reviewer/admin access');

  console.log('Legacy review API access verified; its workbench is currently unavailable while the checklists are being reworked.');

} finally {
  await browser?.close();
  await stopServer(server);
  process.chdir(root);
  await closePostgresPools(process.env.DATABASE_URL);
  if (created) await source.pool.query(`DROP DATABASE "${database}" WITH (FORCE)`);
  await closePostgresPools(original);
  await rm(directory, { recursive: true, force: true });
}
