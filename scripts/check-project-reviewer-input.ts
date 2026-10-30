import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createPostgresClient, closePostgresPools } from '../src/mastra/db/postgres';
import { chromium, getFreePort, startNextServer, stopServer, waitForServer } from './lib/playwright-smoke';

const root = process.cwd(), source = createPostgresClient();
const database = `reviewer_input_${randomUUID().replaceAll('-', '')}`;
const directory = await mkdtemp(join(tmpdir(), 'reviewer-input-'));
let created = false, server: ReturnType<typeof startNextServer> | null = null;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  await source.pool.query(`CREATE DATABASE "${database}"`); created = true;
  const url = new URL(process.env.DATABASE_URL!); url.pathname = '/' + database;
  Object.assign(process.env, { DATABASE_URL: url.toString(), AUTH_SECRET: 'synthetic-reviewer-input', DATASTORE_DIR: directory,
    VIOSCOPE_RUNTIME_CONFIG_CACHE_PATH: join(directory, 'runtime.json'), THEME_MEETING_CONFIG_PATH: join(directory, 'themes.yaml') });
  await writeFile(join(directory, 'themes.yaml'), 'timezone: Europe/London\ncycle:\n  rotation: [AB]\n  anchor_date: 2026-10-28\nthemes: []\n');
  const users = await import('../src/mastra/db/users'); await users.ensureUsersTable();
  const db = createPostgresClient();
  for (const [username, role] of [['owner', 'member'], ['reviewer', 'member'], ['second', 'member'], ['principal', 'pi'], ['secondpi', 'pi']]) {
    await db.pool.query(`INSERT INTO users(id,username,display_name,email,role,provisioning_status,password_reset_required) VALUES($1,$2,$2,$3,$4,'active',false)`, [randomUUID(), username, `${username}@example.test`, role]);
  }
  const owner = (await users.getUserByUsername('owner'))!;
  const { createProject, updateProject } = await import('../src/mastra/db/projects');
  const { createSessionToken, sessionCookieName } = await import('../src/mastra/auth/session');
  const route = await import('../app/api/projects/route');
  for (const [team, error] of [
    [{}, /at least one project PI/],
    [{ piUsernames: [' ', ''], pdraUsernames: ['reviewer'] }, /at least one project PI/],
    [{ piUsernames: ['principal'], pdraUsernames: [] }, /at least one project PDRA/],
    [{ piUsernames: ['reviewer'], pdraUsernames: ['second'] }, /active PI/],
    [{ piUsernames: ['principal'], pdraUsernames: ['owner'] }, /own PDRA/],
  ] as const) {
    const response = await route.POST(new Request('http://localhost/api/projects', { method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `${sessionCookieName}=${createSessionToken(owner)}` },
      body: JSON.stringify({ title: 'Rejected empty team', ...team }) }));
    assert.equal(response.status, 400); assert.match((await response.json()).error, error);
  }
  const project = await createProject({ title: 'Existing project', piUsername: 'principal', pdraUsername: 'reviewer' }, owner);
  const legacy = await updateProject(project.id, { piUsernames: [], pdraUsernames: [], pdraUsername: null }, owner);
  assert.deepEqual(legacy.piUsernames, []);
  await updateProject(project.id, { notes: 'Legacy edits remain available.' }, owner);
  console.log('API rejects missing/invalid reviewers; existing project edits remain compatible.');

  assert.ok(process.env.UI_RUNTIME, 'Use an isolated compiled UI_RUNTIME.');
  process.chdir(resolve(root, process.env.UI_RUNTIME));
  const port = await getFreePort(), base = `http://127.0.0.1:${port}`;
  server = startNextServer({ port, mode: 'start', env: { ...process.env, EMAIL_NOTIFICATIONS_ENABLED: 'false' } });
  await waitForServer(server, base, 240);
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addCookies([{ name: sessionCookieName, value: createSessionToken(owner), url: base }]);
  const page = await context.newPage(); const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addLocatorHandler(page.locator('.welcome-dialog'), () => page.getByLabel('Close welcome message').click());
  await page.goto(base + '/?view=projects');
  await page.getByRole('button', { name: 'Add project', exact: true }).click();
  const modal = page.locator('.project-modal');
  await modal.getByLabel('Full project name').fill('Searchable review team');
  const slug = modal.getByLabel('Slug', { exact: true });
  assert.equal(await slug.inputValue(), 'searchable-review-team');
  await modal.getByLabel('Full project name').fill('Renamed review team');
  assert.equal(await slug.inputValue(), 'renamed-review-team');
  await slug.fill('custom-team');
  await modal.getByLabel('Full project name').fill('Searchable review team');
  assert.equal(await slug.inputValue(), 'custom-team');
  assert.equal(await modal.locator('details.vs-advanced').count(), 0);
  assert.equal(await modal.locator('#venue-hints option[value="ToyConf"]').count(), 0);
  assert.equal(await modal.locator('.checklist-hint').count(), 0);
  const pi = modal.getByRole('textbox', { name: 'Project PIs', exact: true });
  const pdra = modal.getByRole('textbox', { name: 'Project PDRAs', exact: true });
  assert.equal(await modal.locator('select[multiple]').count(), 0);
  assert.equal(await modal.locator('.field-required').count(), 3);
  assert.equal(await pi.getAttribute('aria-describedby'), null);
  assert.equal(await pi.evaluate((input: HTMLInputElement) => input.validity.valueMissing), true);
  await modal.getByRole('button', { name: 'Create project', exact: true }).click();
  assert.equal(await modal.isVisible(), true);
  await pi.fill('princ');
  await modal.getByRole('group', { name: 'Project PIs suggestions' }).getByRole('button', { name: /@principal/ }).click();
  await pi.press('End'); await pi.pressSequentially('secondp');
  await pi.press('Tab'); await page.keyboard.press('Enter');
  assert.equal(await pi.inputValue(), 'principal, secondpi, ');
  await pdra.fill('review');
  await modal.getByRole('group', { name: 'Project PDRAs suggestions' }).getByRole('button', { name: /@reviewer/ }).click();
  await pdra.press('End'); await pdra.pressSequentially('secon');
  await modal.getByRole('group', { name: 'Project PDRAs suggestions' }).getByRole('button', { name: /@second$/ }).click();
  await modal.getByLabel('Lead PDRA reviewer').selectOption('second');
  await pdra.fill('reviewer');
  assert.equal(await modal.getByLabel('Lead PDRA reviewer').inputValue(), 'reviewer');
  await pdra.fill('');
  assert.equal(await modal.getByLabel('Lead PDRA reviewer').inputValue(), '');
  assert.equal(await pdra.evaluate((input: HTMLInputElement) => input.validity.valueMissing), true);
  await pdra.fill('reviewer, second');
  await modal.getByLabel('Collaborators', { exact: true }).fill('sec');
  await modal.getByRole('group', { name: 'Collaborators suggestions' }).getByRole('button', { name: /@second$/ }).click();
  await modal.getByLabel('Full project name').focus();
  const output = resolve(root, '.local/checks/reviewer-input'); await mkdir(output, { recursive: true });
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await pi.scrollIntoViewIfNeeded();
    const piBox = (await pi.boundingBox())!, pdraBox = (await pdra.boundingBox())!;
    const leadBox = (await modal.getByLabel('Lead PDRA reviewer').boundingBox())!;
    const collaboratorBox = (await modal.getByLabel('Collaborators', { exact: true }).boundingBox())!;
    if (width >= 768) {
      assert.ok(Math.abs(piBox.y - pdraBox.y) <= 1, 'PI and PDRA inputs align.');
      assert.ok(Math.abs(leadBox.y - collaboratorBox.y) <= 1, 'Lead and collaborator inputs align.');
    } else {
      for (const box of [pdraBox, leadBox, collaboratorBox]) {
        assert.ok(Math.abs(box.x - piBox.x) <= 1 && Math.abs(box.width - piBox.width) <= 1, 'Mobile fields share aligned edges.');
      }
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: `${output}/form-${width}.png`, animations: 'disabled' });
  }
  const saved = page.waitForResponse(response => response.url().endsWith('/api/projects') && response.request().method() === 'POST');
  await modal.getByRole('button', { name: 'Create project', exact: true }).click();
  const response = await saved; assert.equal(response.status(), 200);
  const result = (await response.json()).project;
  assert.deepEqual(result.piUsernames, ['principal', 'secondpi']);
  assert.deepEqual(result.pdraUsernames, ['reviewer', 'second']);
  assert.equal(result.pdraUsername, 'reviewer');
  assert.equal(result.project, 'custom-team');
  assert.deepEqual(result.collaborators, ['second']);
  assert.deepEqual(errors, []);
  console.log('Compiled UI: search, keyboard/mouse selection, multi-account values, lead removal, required fields, save and three widths passed.');
} finally {
  await browser?.close(); await stopServer(server); process.chdir(root);
  await closePostgresPools(process.env.DATABASE_URL);
  if (created) await source.pool.query(`DROP DATABASE "${database}"`);
  await source.disconnect(); await rm(directory, { recursive: true, force: true });
}
