import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { chromium, getFreePort, startNextServer, waitForServer, stopServer, dismissWelcomeIfVisible } from './lib/playwright-smoke';

const root = process.cwd(), runtime = process.env.UI_RUNTIME;
const temp = runtime ? null : await mkdtemp(join(tmpdir(), 'vioscope-theme-stage-ui-'));
let server: ReturnType<typeof startNextServer> | null = null;
let debugPage: any;
const errors: string[] = [];
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  if (temp) {
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' }).trim().split('\n');
  for (const file of files) {
    const target = join(temp, file); await mkdir(dirname(target), { recursive: true }); await copyFile(join(root, file), target);
  }
  execFileSync('cp', ['-a', '--reflink=auto', resolve(root, 'node_modules') + '/', join(temp, 'node_modules')]);
  }
  process.chdir(runtime ? resolve(root, runtime) : temp!);
  const port = await getFreePort(), base = `http://127.0.0.1:${port}`;
  server = startNextServer({ port, mode: runtime ? 'start' : 'dev' });
  await waitForServer(server, base, 480);
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  debugPage = page;
  page.on('pageerror', error => errors.push(error.stack || error.message));
  const project = { id: '00000000-0000-4000-8000-000000000001', title: 'Synthetic linked project', ownerUsername: 'alice',
    stage: 3, stageProgress: 40, lifecycle: 'active', status: 'on_track', lastUpdate: '2026-10-29',
    updates: [], todos: [], collaborators: [], artifacts: [], recommendation: 'short_update', access: { canEdit: true } };
  const ideaProject = { ...project, id: '00000000-0000-4000-8000-000000000002', title: 'Synthetic idea project', stage: 1 };
  const meeting = { theme_id: 'A', title: 'Synthetic theme', time: '10:00', duration_minutes: 60, coordinator: 'chair',
    members: ['alice'], member_usernames: ['alice'], submitted_members: [], submitted_member_usernames: [], missing_members: ['alice'],
    missing_member_usernames: ['alice'], agenda_items: [] as any[], planned_minutes: 0, overbooked: false, cancelled: false };
  const plan = { meeting_date: '2099-11-04', timezone: 'Europe/London', cycle_group: 'AB', generated_at: '2026-10-29T12:00:00Z', meetings: [meeting] };
  let submitted: Record<string, unknown> | undefined;
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/me') return route.fulfill({ json: { user: { id: 'alice', username: 'alice', displayName: 'alice', role: 'member', notificationPreferences: { theme_meeting_reminders: true }, aliases: [], passwordResetRequired: false } } });
    if (path === '/api/projects') return route.fulfill({ json: { projects: [project, ideaProject, ...[2, 4, 5].map(stage => ({ ...project, stage, id: `stage-${stage}`, title: `Synthetic stage ${stage}` }))] } });
    if (path === '/api/theme-meetings') return route.fulfill({ json: { plan, submissionPlan: plan, notifications: [], users: [], access: { canManageThemeIds: [] }, source: 'configured' } });
    if (path === '/api/theme-meetings/updates') {
      submitted = route.request().postDataJSON();
      meeting.agenda_items = [{ meeting_date: plan.meeting_date, theme_id: 'A', theme_title: meeting.title, member: 'alice', member_username: 'alice',
        update_type: submitted!.updateType, duration_minutes: 5, progress_text: submitted!.progressText, questions: '', submitted_at: '2026-10-29T12:01:00Z',
        project_context: submitted!.projectId ? { projectId: project.id, title: project.title, ownerUsername: 'alice', stage: 3, actions: [] } : undefined }];
      return route.fulfill({ json: { update: meeting.agenda_items[0], plan } });
    }
    return route.fulfill({ status: 503, json: { error: 'Unrelated preview data unavailable' } });
  });
  await page.goto(base + '/?view=meeting'); await page.locator('.console-topbar').waitFor(); await dismissWelcomeIfVisible(page);
  const form = page.locator('.theme-update-form'); await form.waitFor();
  const slots = form.getByRole('combobox', { name: 'Slot type', exact: true });
  assert.deepEqual(await slots.locator('option').allTextContents(), ['Update (5 min)', 'Deep Dive (20-30 min)', 'Nothing to Report (0 min)']);
  assert.equal(await slots.inputValue(), 'short_update');
  const stage = form.getByRole('textbox', { name: 'Project stage', exact: true });
  assert.equal(await stage.inputValue(), '3: experiments/build');
  await form.getByRole('checkbox', { name: /^Link this project/ }).check();
  assert.equal(await stage.inputValue(), '3: experiments/build');
  assert.equal(await stage.getAttribute('readonly'), '');
  await form.getByRole('checkbox', { name: /^Link this project/ }).uncheck();
  assert.match((await form.getByRole('textbox', { name: /^Progress/ }).getAttribute('placeholder'))!, /The Wall/);
  await form.getByRole('checkbox', { name: /^Link this project/ }).check();
  await form.getByRole('textbox', { name: /^Progress/ }).fill('Completed the synthetic baseline.');
  await form.getByRole('button', { name: 'Submit update', exact: true }).click();
  await page.getByText('Update submitted.', { exact: true }).waitFor();
  assert.equal(submitted!.projectId, project.id);
  assert.equal(submitted!.stage, undefined);
  await form.getByText('Previously shared project snapshot', { exact: true }).click();
  assert.match(await form.locator('details').innerText(), /Project stage: 3/);
  const output = resolve(root, '.local/checks/theme-stage'); await mkdir(output, { recursive: true });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 }); await stage.scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: join(output, `stage-${width}.png`) });
  }
  await form.getByRole('checkbox', { name: /^Link this project/ }).uncheck();
  assert.equal(await stage.inputValue(), '3: experiments/build');
  const progress = form.getByRole('textbox', { name: /^Progress/ });
  await progress.fill('');
  await form.getByRole('combobox', { name: 'Project source', exact: true }).selectOption(ideaProject.id);
  assert.equal(await form.getByRole('checkbox', { name: /^Link this project/ }).isChecked(), false);
  assert.equal(await stage.inputValue(), '1: idea/proposal');
  assert.match((await progress.getAttribute('placeholder'))!, /The Pain Point: \(1 Sentence\)/);
  assert.match((await progress.getAttribute('placeholder'))!, /The Wild Factor: High \/ Med \/ Low/);
  assert.match((await progress.getAttribute('placeholder'))!, /Proof of Concept \(PoC\) Goal/);
  assert.ok((await progress.getAttribute('placeholder'))!.split('\n').every(line => line.startsWith('- ')));
  assert.equal(await progress.inputValue(), '', 'Placeholders never become saved content.');
  await progress.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(output, 'stage-1-placeholder.png') });
  await progress.fill('Keep my own draft.');
  await form.getByRole('combobox', { name: 'Project source', exact: true }).selectOption(project.id);
  assert.equal(await progress.inputValue(), 'Keep my own draft.', 'Changing project guidance preserves written content.');
  for (const [id, heading] of [[project.id, 'The Wall'], ['stage-2', 'The Signal'], ['stage-4', 'Figure 1 Status'], ['stage-5', 'The "Lethal" Critique']]) {
    await form.getByRole('combobox', { name: 'Project source', exact: true }).selectOption(id);
    assert.equal(await form.getByRole('checkbox', { name: /^Link this project/ }).isChecked(), false);
    assert.equal((await stage.inputValue()).startsWith(id === project.id ? '3:' : id.slice(-1) + ':'), true);
    const placeholder = (await progress.getAttribute('placeholder'))!;
    assert.ok(placeholder.includes(heading));
    assert.ok(placeholder.split('\n').every(line => line.startsWith('- ')));
    assert.equal(await progress.inputValue(), 'Keep my own draft.');
  }
  await form.getByRole('button', { name: 'Save changes', exact: true }).click();
  await page.getByText('Changes saved.', { exact: true }).waitFor();
  assert.equal(submitted!.projectId, undefined, 'Stage preview does not silently share a project snapshot.');
  assert.deepEqual(errors, []);
  console.log('Theme meeting browser checks passed: three choices, inherited read-only stage, saved snapshot, unlinking, five stage placeholders without draft replacement, desktop/mobile. Synthetic API data only.');
} catch (error) {
  console.log(errors);
  if (debugPage) console.log(await debugPage.locator('body').innerText());
  throw error;
} finally {
  await browser?.close(); await stopServer(server); process.chdir(root); if (temp) await rm(temp, { recursive: true, force: true });
}
