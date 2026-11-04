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
    project_context: { projectId: `00000000-0000-4000-8000-00000000000${index + 1}`, title: ['Robust model evaluation', 'Data quality benchmark', 'Efficient experiment design'][index], ownerUsername: username, stage: 3, actions: [{ id: 'action-1', text: 'Quantify frequency metrics', dueDate: '2026-11-27' }] },
  }));
  const meeting = { theme_id: 'A', title: 'Methods & Evaluation', time: '10:00', duration_minutes: 60, coordinator: 'Taylor Chen', coordinator_username: 'chair',
    members: names, member_usernames: ['alex', 'sam', 'jordan'], submitted_members: names, submitted_member_usernames: ['alex', 'sam', 'jordan'], missing_members: [], missing_member_usernames: [],
    agenda_items: defaultAgenda(updates, date, 'A', 'Methods & Evaluation'), planned_minutes: 50, overbooked: false, cancelled: false, cancellation: null };
  const other = { ...meeting, theme_id: 'B', title: 'Systems & Applications', time: '11:00', agenda_items: defaultAgenda([], date, 'B', 'Systems & Applications'), members: [], member_usernames: [], submitted_members: [], submitted_member_usernames: [], planned_minutes: 10 };
  const plan = { meeting_date: date, timezone: 'Europe/London', cycle_group: 'AB', generated_at: '2026-10-30T12:00:00Z', meetings: [meeting, other] };
  let confirmed: any = null;
  let posted: any = null;
  let manager = true;
  let canAddAction = true;
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === '/api/auth/me') return route.fulfill({ json: { user: { id: manager ? 'chair-id' : 'alex-id', username: manager ? 'chair' : 'alex', displayName: manager ? 'Taylor Chen' : names[0], role: 'member', aliases: [], notificationPreferences: { theme_meeting_reminders: { web: true, email: true } }, passwordResetRequired: false } } });
    if (path === '/api/prompts/ui-copy') return route.fulfill({ json: { prompts: uiCopyPrompts } });
    if (path === '/api/projects') return route.fulfill({ json: { projects: [] } });
    if (path === '/api/theme-meetings') return route.fulfill({ json: { plan, submissionPlan: { ...plan, meetings: [{ ...meeting, members: [...names, 'Taylor Chen'], member_usernames: ['alex', 'sam', 'jordan', 'chair'] }] }, notifications: [], users: [],
      access: { canManageThemeIds: manager ? ['A', 'B'] : [] }, source: 'configured', agendaPreview: { weekday: 'Tuesday', time: '13:00' },
      agendaSubscriptions: [meeting, other].map((m) => ({ theme_id: m.theme_id, title: m.title, required: true, subscribed: true, reason: 'coordinator' })) } });
    if (path === '/api/theme-meetings/workflow') {
      const m = url.searchParams.get('themeId') === 'B' ? other : meeting;
      if (route.request().method() === 'POST') {
        posted = route.request().postDataJSON();
        if (posted.operation === 'add_action') return route.fulfill({ json: { ok: true } });
        assert.equal(posted.operation, 'confirm');
        confirmed = { meetingDate: date, themeId: 'A', version: 1, confirmedBy: 'chair', confirmedAt: '2026-10-30T12:15:00Z',
          entries: posted.entries.map((selection: any) => ({ ...(meeting.agenda_items.find((item) => item.member_username === selection.username) || confirmed?.entries.find((item: any) => item.member_username === selection.username) || { meeting_date: date, theme_id: 'A', theme_title: meeting.title, member: selection.speakerName, member_username: selection.username, update_type: 'short_update', progress_text: '', questions: '', submitted_at: '2026-10-30T12:00:00Z' }), ...(selection.speakerSummary !== undefined ? { progress_text: selection.speakerSummary } : {}), duration_minutes: selection.minutes, deferred: false })) };
        return route.fulfill({ json: { ok: true, version: 1 } });
      }
      return route.fulfill({ json: { viewerId: manager ? 'chair-id' : 'alex-id', viewerUsername: manager ? 'chair' : 'alex', manager, canAddAction, cancelled: false, duration: 60, sourceVersion: confirmed ? 'confirmed-v1' : 'draft-v0', members: m.member_usernames,
        candidates: manager ? [...m.agenda_items, ...(m.theme_id === 'A' ? confirmed?.entries.filter((item: any) => item.member_username.startsWith(':speaker:')) || [] : [])] : m.agenda_items.filter((item) => item.member_username?.startsWith(':') || item.member_username === 'alex'), confirmation: m.theme_id === 'A' ? confirmed : null, projects: [], actions: [] } });
    }
    return route.fulfill({ json: { notifications: [], sessions: [], users: [], count: 0, unreadCount: 0 } });
  });
  await page.goto(base + '/?view=meeting');
  await page.locator('.console-topbar').waitFor();
  await dismissWelcomeIfVisible(page);
  const list = page.getByRole('list', { name: 'Agenda', exact: true });
  await list.locator('li').filter({ hasText: 'PI announcement' }).waitFor();
  await page.getByRole('button', { name: 'Temporary speaker', exact: true }).click();
  assert.deepEqual(await list.locator('.mt-item-main > strong').allTextContents(), ['PI announcement', 'Robust model evaluation', 'Data quality benchmark', 'Efficient experiment design']);
  assert.deepEqual(await list.locator('time').allTextContents(), ['10:00', '10:05', '10:35', '10:40']);
  assert.equal(Boolean(posted), false);
  await list.getByText('Project snapshot').first().click();
  assert.notEqual(await list.locator('.meeting-project-summary li').first().evaluate(element => getComputedStyle(element).display), 'grid');
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
  const agendaBox = (await page.locator('.mt-agenda').boundingBox())!;
  const speakerFormBox = (await page.locator('.mt-temporary-form').boundingBox())!;
  assert.ok(speakerFormBox.x > agendaBox.x, 'Temporary speaker form appears to the right of the agenda on desktop.');
  await page.getByRole('spinbutton', { name: 'Minutes for Sam Taylor' }).fill('15');
  await page.getByRole('spinbutton', { name: 'Minutes for Alex Morgan' }).fill('20');
  await page.getByLabel('Temporary speaker name').fill('Guest speaker');
  await page.getByLabel('Temporary speaker summary').fill('Discuss the new results.');
  assert.equal(await page.getByRole('button', { name: 'Confirm the agenda as version 1' }).isDisabled(), true, 'An unapplied speaker form blocks confirmation.');
  await page.getByRole('button', { name: 'Add to agenda' }).click();
  await list.getByText('Guest speaker', { exact: true }).waitFor();
  await page.getByLabel('Temporary speaker name').fill('Fourth update');
  await page.getByRole('button', { name: 'Add to agenda', exact: true }).click();
  await list.getByText('Fourth update', { exact: true }).waitFor();
  assert.equal(await page.getByRole('note').filter({ hasText: /This agenda has/ }).count(), 0);
  const confirmButton = page.getByRole('button', { name: 'Confirm the agenda as version 1' });
  assert.equal(await confirmButton.isEnabled(), true, 'Four Updates within 60 minutes can be confirmed.');
  await page.getByRole('spinbutton', { name: 'Minutes for Fourth update' }).fill('11');
  assert.equal(await confirmButton.isEnabled(), false, 'An agenda of 61 minutes cannot be confirmed.');
  await page.getByRole('button', { name: 'Remove temporary speaker Fourth update' }).click();

  await page.getByRole('spinbutton', { name: 'Minutes for PI announcement' }).fill('6');
  const handle = list.getByRole('button', { name: /Reorder Guest speaker/ });
  await handle.focus(); await handle.press('ArrowUp');
  assert.deepEqual(await list.locator('.mt-item-main > strong').allTextContents(), ['PI announcement', 'Robust model evaluation', 'Data quality benchmark', 'Guest speaker', 'Efficient experiment design']);
  await page.getByRole('spinbutton', { name: 'Minutes for Alex Morgan' }).fill('60');
  assert.equal(await page.getByRole('button', { name: 'Confirm the agenda as version 1' }).isDisabled(), true);
  await page.getByRole('spinbutton', { name: 'Minutes for Alex Morgan' }).fill('20');
  await page.getByRole('button', { name: 'Confirm the agenda as version 1' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click();
  await page.getByText('Version 1 confirmed. Email it when you are ready.', { exact: true }).waitFor();
  assert.equal(posted.entries[0].minutes, 6);
  assert.equal(posted.entries[2].minutes, 15);
  assert.ok(posted.entries.every((entry: any) => entry.username !== ':assignments'));
  const refreshed = page.waitForResponse(response => response.url().includes('/api/theme-meetings/workflow') && response.request().method() === 'GET');
  await page.reload(); await refreshed; await list.waitFor();
  await dismissWelcomeIfVisible(page);
  // A confirmation saved before the Assignments slot was retired still holds it; that is not a draft change.
  confirmed.entries.push({ meeting_date: date, theme_id: 'A', theme_title: 'Theme A', member: 'Assignments', member_username: ':assignments', update_type: 'assignments',
    duration_minutes: 5, progress_text: '', questions: '', submitted_at: '2026-10-29T12:00:00Z', deferred: false });
  await page.reload(); await list.waitFor(); await dismissWelcomeIfVisible(page);
  await page.getByRole('button', { name: 'Confirm the agenda as version 2' }).waitFor();
  assert.equal(await page.getByText(/Submissions changed since version 1|Draft changed\./).count(), 0, 'A retired placeholder in an older confirmation is not a change.');
  assert.equal(await page.getByRole('button', { name: 'Confirm the agenda as version 2' }).isDisabled(), true, 'The older confirmation is still up to date.');
  confirmed.entries.pop();
  await page.reload(); await list.waitFor(); await dismissWelcomeIfVisible(page);
  await page.getByRole('button', { name: 'Edit temporary speaker Guest speaker' }).click();
  assert.equal(await page.getByLabel('Temporary speaker summary').inputValue(), 'Discuss the new results.');
  await page.getByRole('button', { name: 'Confirm the agenda as version 2' }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Confirm the agenda as version 2' }).isDisabled(), true);
  await page.getByRole('spinbutton', { name: 'Minutes for Guest speaker' }).fill('6');
  assert.equal(await page.getByRole('button', { name: 'Confirm the agenda as version 2' }).isEnabled(), true);
  await page.getByLabel('Temporary speaker summary').fill('Discuss the revised results.');
  assert.equal(await page.getByRole('button', { name: 'Email confirmed agenda version 1' }).isDisabled(), true, 'Unapplied changes cannot be emailed as the old version.');
  assert.equal(await page.getByRole('button', { name: 'Confirm the agenda as version 2' }).isDisabled(), true, 'An unapplied summary edit blocks confirmation.');
  await page.getByRole('button', { name: 'Update agenda draft' }).click();
  assert.equal(await page.getByRole('button', { name: 'Email confirmed agenda version 1' }).isDisabled(), true, 'Applied changes must be confirmed before emailing.');
  await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('[aria-label="Confirm the agenda as version 2"]')?.disabled);
  manager = false;
  await page.reload(); await list.waitFor();
  await list.locator('li').filter({ hasText: 'PI announcement' }).waitFor();
  assert.equal(await list.getByRole('spinbutton').count(), 0, 'Members cannot change the arrangement.');
  assert.equal(await list.locator(':scope > li').count(), 5, 'Members see the confirmed placeholder and submitted slots.');
  await list.getByText('Guest speaker', { exact: true }).waitFor();
  await list.getByText('Discuss the new results.', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('Temporary speaker summary').count(), 0, 'Members cannot edit summaries.');
  await dismissWelcomeIfVisible(page);
  await page.getByText('Decisions & actions', { exact: false }).first().click();
  const actionForm = page.getByRole('group', { name: 'Record a decision and action' });
  await actionForm.waitFor();
  assert.equal(await actionForm.getByLabel('Responsible member').getAttribute('readonly'), '');
  await actionForm.getByLabel('Decision', { exact: true }).fill('Review the baseline.');
  await actionForm.getByLabel('Next action').fill('Run the experiment.');
  await actionForm.getByLabel('Due date').fill('2026-11-06');
  await actionForm.getByRole('button', { name: 'Add action' }).click();
  await page.waitForFunction(() => document.body.textContent?.includes('Saved.'));
  assert.equal(posted.action.owner, 'alex', 'Member-created actions are assigned to the signed-in member.');
  canAddAction = false;
  await page.reload(); await list.waitFor();
  await dismissWelcomeIfVisible(page);
  await page.getByText('Decisions & actions', { exact: false }).first().click();
  await page.getByText('New decisions and actions can be added until 16:00 UK time on the Friday after the meeting. You can still update actions assigned to you.').waitFor();
  assert.equal(await page.getByRole('group', { name: 'Record a decision and action' }).count(), 0);
  assert.deepEqual(errors, []);
  console.log(`Agenda browser checks passed: default order, 1440/768/390 layouts, keyboard sorting, durations, overbooking, confirmation persistence and member view. Screenshots: ${output}`);
} finally {
  await browser?.close();
  await stopServer(server);
}
