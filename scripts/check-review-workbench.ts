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

  const page = await context.newPage(), errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base + '/?view=checklists');
  await page.locator('.console-topbar').waitFor();
  await dismissWelcomeIfVisible(page);
  await page.getByRole('tab', { name: 'PDRA Meta-Review', exact: true }).click();
  const draft = page.locator('textarea[name="draftText"]');
  const run = page.getByRole('button', { name: 'Run This Check', exact: true });
  const save = page.getByRole('button', { name: 'Save Run', exact: true });
  let pending: any, requestCount = 0;
  await page.route('**/api/submission-review', route => { requestCount++; pending = route; });
  async function waitPending() {
    for (let i = 0; i < 100 && !pending; i++) await page.waitForTimeout(50);
    assert.ok(pending, 'Expected review request');
  }
  async function release() {
    const route = pending; pending = undefined;
    await route.fulfill({ json: result });
    await run.waitFor();
    await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(button => button.textContent?.trim() === 'Run This Check')?.disabled);
  }
  await draft.fill('Draft A');
  await run.click(); await waitPending();
  await draft.fill('Draft B');
  await release();
  assert.equal(await save.isDisabled(), true);
  assert.equal(await page.getByText(result.structured.summary, { exact: true }).count(), 0);
  console.log('PASS: late result from previous draft is discarded');

  const beforeAll = requestCount;
  await page.getByRole('button', { name: 'Run All', exact: true }).click(); await waitPending();
  await draft.fill('Draft C');
  await release(); await page.waitForTimeout(200);
  assert.equal(requestCount, beforeAll + 1);
  assert.equal(await save.isDisabled(), true);
  console.log('PASS: Run All stops when its draft changes');

  await page.locator('input[type="file"][name="draftFile"]').setInputFiles({ name: 'old.txt', mimeType: 'text/plain', buffer: Buffer.from('Old uploaded draft') });
  await page.getByRole('button', { name: /Own older review/ }).click();
  await page.getByText('Opened saved results.', { exact: false }).waitFor();
  assert.equal(await draft.inputValue(), '');
  assert.equal(await page.locator('input[name="draftFile"]').evaluate((element: HTMLInputElement) => element.files?.length), 0);
  await draft.fill('New independent draft');
  await run.click(); await waitPending(); await release();
  const savedResponse = page.waitForResponse(response => response.url().endsWith('/api/review-runs') && response.request().method() === 'POST');
  await save.click();
  const saved = await savedResponse;
  assert.equal(saved.status(), 200);
  const newRun = (await saved.json()).run;
  assert.notEqual(newRun.id, own.id);
  const unchanged = await context.request.get(base + '/api/review-runs/' + own.id);
  assert.equal((await unchanged.json()).run.updatedAt, own.updatedAt);
  console.log('PASS: opening history clears text/file and rerunning creates a separate record');
  const output = resolve(root, '.local/checks/review-fixes');
  await mkdir(output, { recursive: true });
  await page.screenshot({ path: join(output, 'review-workbench.png'), fullPage: true });
  assert.deepEqual(errors, []);
} finally {
  await browser?.close();
  await stopServer(server);
  process.chdir(root);
  await closePostgresPools(process.env.DATABASE_URL);
  if (created) await source.pool.query(`DROP DATABASE "${database}" WITH (FORCE)`);
  await closePostgresPools(original);
  await rm(directory, { recursive: true, force: true });
}
