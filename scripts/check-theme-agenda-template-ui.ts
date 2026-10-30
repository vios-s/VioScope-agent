import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { defaultAgenda } from '../src/mastra/theme-meetings/agenda-template';
import { uiCopyPrompts } from '../src/mastra/prompts';
import { chromium, getFreePort, startNextServer, waitForServer, stopServer, dismissWelcomeIfVisible } from './lib/playwright-smoke';

const root = process.cwd();
const output = resolve(root, '.local/checks/agenda-template');
await mkdir(output, { recursive: true });
assert.ok(process.env.UI_RUNTIME, 'Use an isolated compiled candidate.');
process.chdir(resolve(root, process.env.UI_RUNTIME!));
const port = await getFreePort();
const base = `http://127.0.0.1:${port}`;
const server = startNextServer({ port, mode: 'start' });
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  await waitForServer(server, base, 240);
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const date = '2026-11-04';
  const names = ['Alex Morgan', 'Sam Taylor', 'Jordan Lee'];
  const updates = ['alex', 'sam', 'jordan'].map((username, index) => ({
    meeting_date: date, theme_id: 'A', theme_title: 'Methods & Evaluation', member: names[index], member_username: username,
    update_type: index === 0 ? 'deep_dive' as const : 'short_update' as const, duration_minutes: index === 0 ? 30 : 5,
    progress_text: 'Current metric recorded. Review the comparison and agree the next experiment.', questions: '', submitted_at: '2026-10-30T12:00:00Z',
    project_context: { projectId: `00000000-0000-4000-8000-00000000000${index + 1}`, title: ['Robust model evaluation', 'Data quality benchmark', 'Efficient experiment design'][index], ownerUsername: username, stage: 3, actions: [] },
  }));
  const meeting = { theme_id: 'A', title: 'Methods & Evaluation', time: '10:00', duration_minutes: 60, coordinator: 'Taylor Chen', coordinator_username: 'chair',
    members: names, member_usernames: ['alex', 'sam', 'jordan'], submitted_members: names, submitted_member_usernames: ['alex', 'sam', 'jordan'], missing_members: [], missing_member_usernames: [],
    agenda_items: defaultAgenda(updates, date, 'A', 'Methods & Evaluation'), planned_minutes: 50, overbooked: false, cancelled: false, cancellation: null };
  const other = { ...meeting, theme_id: 'B', title: 'Systems & Applications', time: '11:00', agenda_items: defaultAgenda([], date, 'B', 'Systems & Applications'), members: [], member_usernames: [], submitted_members: [], submitted_member_usernames: [], planned_minutes: 10 };
  const plan = { meeting_date: date, timezone: 'Europe/London', cycle_group: 'AB', generated_at: '2026-10-30T12:00:00Z', meetings: [meeting, other] };
  let confirmed: any = null;
  let posted: any = null;
  let manager = true;
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === '/api/auth/me') return route.fulfill({ json: { user: { id: manager ? 'chair-id' : 'alex-id', username: manager ? 'chair' : 'alex', displayName: manager ? 'Taylor Chen' : names[0], role: 'member', aliases: [], notificationPreferences: { theme_meeting_reminders: { web: true, email: true } }, passwordResetRequired: false } } });
    if (path === '/api/prompts/ui-copy') return route.fulfill({ json: { prompts: uiCopyPrompts } });
    if (path === '/api/projects') return route.fulfill({ json: { projects: [] } });
    if (path === '/api/theme-meetings') return route.fulfill({ json: { plan, submissionPlan: { ...plan, meetings: [] }, notifications: [], users: [],
      access: { canManageThemeIds: manager ? ['A', 'B'] : [] }, source: 'configured', agendaPreview: { weekday: 'Tuesday', time: '13:00' },
      agendaSubscriptions: [meeting, other].map((m) => ({ theme_id: m.theme_id, title: m.title, required: true, subscribed: true, reason: 'coordinator' })) } });
    if (path === '/api/theme-meetings/workflow') {
      const m = url.searchParams.get('themeId') === 'B' ? other : meeting;
      if (route.request().method() === 'POST') {
        posted = route.request().postDataJSON();
        assert.equal(posted.operation, 'confirm');
        confirmed = { meetingDate: date, themeId: 'A', version: 1, confirmedBy: 'chair', confirmedAt: '2026-10-30T12:15:00Z',
          entries: posted.entries.map((selection: any) => ({ ...meeting.agenda_items.find((item) => item.member_username === selection.username), duration_minutes: selection.minutes, deferred: false })) };
        return route.fulfill({ json: { ok: true, version: 1 } });
      }
      return route.fulfill({ json: { viewerId: manager ? 'chair-id' : 'alex-id', viewerUsername: manager ? 'chair' : 'alex', manager, cancelled: false, duration: 60, sourceVersion: confirmed ? 'confirmed-v1' : 'draft-v0', members: m.member_usernames,
        candidates: manager ? m.agenda_items : m.agenda_items.filter((item) => item.member_username?.startsWith(':') || item.member_username === 'alex'), confirmation: m.theme_id === 'A' ? confirmed : null, projects: [], actions: [] } });
    }
    return route.fulfill({ json: { notifications: [], sessions: [], users: [], count: 0, unreadCount: 0 } });
  });
  await page.goto(base + '/?view=meeting');
  await page.locator('.console-topbar').waitFor();
  await dismissWelcomeIfVisible(page);
  const list = page.getByRole('list', { name: 'Agenda', exact: true });
  await list.locator('li').filter({ hasText: 'Triage & Admin' }).waitFor();
  assert.deepEqual(await list.locator('.mt-item-main > strong').allTextContents(), ['Triage & Admin', 'Robust model evaluation', 'Data quality benchmark', 'Efficient experiment design', 'Assignments']);
  assert.deepEqual(await list.locator('time').allTextContents(), ['10:00', '10:05', '10:35', '10:40', '10:45']);
  assert.equal(Boolean(posted), false);
  await page.screenshot({ path: resolve(output, 'desktop.png'), fullPage: true });
  await page.getByText('Recommended meeting format · 60 minutes', { exact: true }).click();
  await page.locator('.mt-agenda').screenshot({ path: resolve(output, 'agenda-guidance.png') });
  await page.getByText('Recommended meeting format · 60 minutes', { exact: true }).click();
  for (const width of [768, 390]) {
    await page.setViewportSize({ width, height: 1100 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const closeNavigation = page.getByRole('button', { name: 'Close navigation', exact: true });
    if (await closeNavigation.isVisible()) await closeNavigation.click();
    await page.evaluate(() => { window.scrollTo(0, 0); document.querySelectorAll('*').forEach((el) => { if (el.scrollTop) el.scrollTop = 0; }); });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `No horizontal page overflow at ${width}.`);
    await page.screenshot({ path: resolve(output, `width-${width}.png`), fullPage: true, animations: 'disabled' });
  }
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.getByRole('spinbutton', { name: 'Minutes for Sam Taylor' }).fill('7');
  await page.getByRole('spinbutton', { name: 'Minutes for Triage & Admin' }).fill('6');
  const handle = list.getByRole('button', { name: /Reorder Assignments/ });
  await handle.focus(); await handle.press('ArrowUp');
  assert.deepEqual(await list.locator('.mt-item-main > strong').allTextContents(), ['Triage & Admin', 'Robust model evaluation', 'Data quality benchmark', 'Assignments', 'Efficient experiment design']);
  await page.getByRole('spinbutton', { name: 'Minutes for Alex Morgan' }).fill('60');
  assert.equal(await page.getByRole('button', { name: 'Confirm the agenda as version 1' }).isDisabled(), true);
  await page.getByRole('spinbutton', { name: 'Minutes for Alex Morgan' }).fill('30');
  await page.getByRole('button', { name: 'Confirm the agenda as version 1' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click();
  await page.getByText('Version 1 confirmed. Email it when you are ready.', { exact: true }).waitFor();
  assert.equal(posted.entries[0].minutes, 6);
  assert.equal(posted.entries[2].minutes, 7);
  assert.equal(posted.entries[3].username, ':assignments');
  await page.reload(); await list.waitFor();
  await page.getByRole('button', { name: 'Confirm the agenda as version 2' }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Confirm the agenda as version 2' }).isDisabled(), true);
  manager = false;
  await page.reload(); await list.waitFor();
  await list.locator('li').filter({ hasText: 'Assignments' }).waitFor();
  assert.equal(await list.getByRole('spinbutton').count(), 0, 'Members cannot change the arrangement.');
  assert.equal(await list.locator('li').count(), 5, 'Members see the confirmed placeholders and submitted slots.');
  assert.deepEqual(errors, []);
  console.log(`Agenda browser checks passed: default order, 1440/768/390 layouts, keyboard sorting, durations, overbooking, confirmation persistence and member view. Screenshots: ${output}`);
} finally {
  await browser?.close();
  await stopServer(server);
}
