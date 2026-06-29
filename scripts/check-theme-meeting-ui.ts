import 'dotenv/config';
import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, dismissWelcomeIfVisible, startNextServer, stopServer, waitForServer } from './lib/playwright-smoke';
import { createPostgresClient } from '../src/mastra/db/postgres';
import { upsertLocalUser, type UserRole } from '../src/mastra/db/users';

const password = 'ThemeUi1!';
const port = 3127;
const baseUrl = `http://127.0.0.1:${port}`;
const stamp = Date.now().toString(36);
const runtimeDir = resolve('.local/checks');
const configPath = resolve(runtimeDir, `theme-meeting-ui-${stamp}.yaml`);
const updatesPath = resolve(runtimeDir, `theme-meeting-ui-${stamp}-updates.yaml`);
const notificationsPath = resolve(runtimeDir, `theme-meeting-ui-${stamp}-notifications.yaml`);
const runtimeCachePath = resolve(runtimeDir, `theme-meeting-ui-${stamp}-runtime.json`);

const users = {
  member: `ui.member.${stamp}`,
  coordinator: `ui.coord.${stamp}`,
  coordA: `ui.coord.a.${stamp}`,
  coordC: `ui.coord.c.${stamp}`,
  coordD: `ui.coord.d.${stamp}`,
  memberA: `ui.member.a.${stamp}`,
  memberB: `ui.member.b.${stamp}`,
  memberC: `ui.member.c.${stamp}`,
  pi: `ui.pi.${stamp}`,
  admin: `ui.admin.${stamp}`,
};
const usernames = Object.values(users);

async function seedUser(username: string, role: UserRole, displayName: string) {
  await upsertLocalUser({
    username,
    role,
    email: `${username}@example.test`,
    displayName,
    password,
    passwordResetRequired: false,
    source: 'theme_meeting_ui_check',
    metadata: { temporary_theme_meeting_ui_check: true },
  });
}

async function writeMockConfig() {
  await mkdir(runtimeDir, { recursive: true });
  await writeFile(
    configPath,
    `timezone: Europe/London
cycle:
  weekday: Wednesday
  rotation:
    - AB
    - CD
  anchor_date: 2026-06-24
pis:
  - UI PI
pi_users:
  - ${users.pi}
administrator: UI Admin
administrator_user: ${users.admin}
themes:
  - theme_id: A
    title: UI Theme A
    cycle_group: AB
    weekday: Wednesday
    time: "10:00"
    duration_minutes: 60
    coordinator: UI Coordinator A
    coordinator_user: ${users.coordA}
    members:
      - UI Member A
    member_users:
      - ${users.memberA}
  - theme_id: B
    title: UI Theme B
    cycle_group: AB
    weekday: Wednesday
    time: "11:00"
    duration_minutes: 60
    coordinator: UI Coordinator
    coordinator_user: ${users.coordinator}
    members:
      - UI Coordinator
      - UI Member B
    member_users:
      - ${users.coordinator}
      - ${users.memberB}
  - theme_id: C
    title: UI Theme C
    cycle_group: CD
    weekday: Wednesday
    time: "10:00"
    duration_minutes: 60
    coordinator: UI Coordinator C
    coordinator_user: ${users.coordC}
    members:
      - UI Member C
    member_users:
      - ${users.memberC}
  - theme_id: D
    title: UI Theme D
    cycle_group: CD
    weekday: Wednesday
    time: "11:00"
    duration_minutes: 60
    coordinator: UI Coordinator D
    coordinator_user: ${users.coordD}
    members:
      - UI Member
      - UI Admin
    member_users:
      - ${users.member}
      - ${users.admin}
submission:
  progress_word_target: 50
  update_types:
    nothing_to_report:
      duration_minutes: 0
      questions_required: false
    deep_dive:
      duration_minutes: 30
      questions_required: false
    milestone_check:
      duration_minutes: 10
      questions_required: false
    strategic_slot:
      duration_minutes: 10
      questions_required: false
reminders: []
permissions:
  member:
    - edit_own_update
  coordinator:
    - manage_own_theme
  pi:
    - review_all_theme_dashboards
    - manage_all_theme_meetings
  administrator:
    - all_permissions
`,
  );
}

function startServer() {
  return startNextServer({
    port,
    mode: 'start',
    env: {
      THEME_MEETING_CONFIG_PATH: configPath,
      THEME_MEETING_UPDATES_PATH: updatesPath,
      THEME_MEETING_NOTIFICATIONS_PATH: notificationsPath,
      VIOSCOPE_RUNTIME_CONFIG_CACHE_PATH: runtimeCachePath,
    },
  });
}

async function login(page: any, username: string) {
  await page.goto(baseUrl);
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByText('Briefing').first().waitFor({ state: 'visible', timeout: 15_000 });
  await dismissWelcomeIfVisible(page);
  await page.getByRole('button', { name: 'Meeting' }).click();
  await page.getByRole('heading', { name: 'Next Theme Meeting' }).waitFor({ state: 'visible', timeout: 15_000 });
}

async function expectVisible(page: any, text: string) {
  await page.getByText(text, { exact: false }).first().waitFor({ state: 'visible', timeout: 10_000 });
}

async function checkMember(browser: any) {
  const page = await browser.newPage();
  await login(page, users.member);
  await expectVisible(page, 'Past meetings');
  await page.locator('.theme-update-form').waitFor({ state: 'visible', timeout: 10_000 });
  await page.getByText(/^For \d{2}\/\d{2}\/\d{4}$/).waitFor({ state: 'visible', timeout: 10_000 });
  assert.equal(await page.locator('.theme-update-form select').first().inputValue(), 'D');
  const slotSelect = page.locator('.theme-update-form select').nth(2);
  assert.equal(await slotSelect.locator('option[value="deep_dive"]').textContent(), 'Deep dive (20-30 min)');
  assert.equal(await slotSelect.locator('option[value="milestone_check"]').textContent(), 'Milestone check (10 min)');
  assert.equal(await slotSelect.locator('option[value="strategic_slot"]').textContent(), 'Strategic slot (paper or idea)');
  assert.equal(await slotSelect.locator('option[value="nothing_to_report"]').textContent(), 'Nothing to report (0 min)');
  await slotSelect.selectOption('nothing_to_report');
  await page.locator('.theme-update-form textarea').nth(0).fill('Finished a mock UI smoke test update for the next meeting.');
  await page.locator('.theme-update-form textarea').nth(1).fill('Can the UI save this member update?');
  await page.getByRole('button', { name: 'Update' }).click();
  await expectVisible(page, 'Update saved.');
  await page.getByRole('button', { name: 'Settings' }).click();
  assert.equal(await page.getByRole('button', { name: 'Theme meeting' }).count(), 0, 'Member should not see theme meeting settings.');
  await page.close();
}

async function checkCoordinator(browser: any) {
  const page = await browser.newPage();
  await login(page, users.coordinator);
  await expectVisible(page, 'Past meetings');
  await page.locator('.theme-update-form').waitFor({ state: 'visible', timeout: 10_000 });
  await page.getByText(/^For \d{2}\/\d{2}\/\d{4}$/).waitFor({ state: 'visible', timeout: 10_000 });
  assert.equal(await page.locator('.theme-update-form select').first().inputValue(), 'B');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Theme meeting' }).click();
  await expectVisible(page, 'Meeting configuration');
  await expectVisible(page, 'Theme B');
  await page.close();
}

async function checkPlanningOnly(browser: any, username: string) {
  const page = await browser.newPage();
  await login(page, username);
  await expectVisible(page, 'Theme A');
  await expectVisible(page, 'Theme B');
  await expectVisible(page, 'Past meetings');
  assert.equal(await page.locator('.theme-update-form').count(), 0);
  assert.ok(await page.getByText('Remind missing').count() > 0, 'PI/admin planning view should expose theme management actions.');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Theme meeting' }).click();
  await expectVisible(page, 'Meeting configuration');
  await expectVisible(page, 'Theme A');
  await page.close();
}

async function checkAdminMember(browser: any) {
  const page = await browser.newPage();
  await login(page, users.admin);
  await expectVisible(page, 'Theme A');
  await expectVisible(page, 'Theme B');
  await page.locator('.theme-update-form').waitFor({ state: 'visible', timeout: 10_000 });
  await page.getByText(/^For \d{2}\/\d{2}\/\d{4}$/).waitFor({ state: 'visible', timeout: 10_000 });
  assert.equal(await page.locator('.theme-update-form select').first().inputValue(), 'D');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Theme meeting' }).click();
  await expectVisible(page, 'Meeting configuration');
  await expectVisible(page, 'All theme groups');
  await expectVisible(page, 'UI Theme D');
  await page.close();
}

async function cleanup() {
  const postgres = createPostgresClient('theme-meeting-ui-cleanup');
  try {
    await postgres.pool.query('DELETE FROM users WHERE username = ANY($1::text[])', [usernames]).catch(() => undefined);
    await postgres.pool.query('DELETE FROM audit_log WHERE actor_username = ANY($1::text[]) OR target_id = ANY($1::text[])', [
      usernames,
    ]).catch(() => undefined);
  } finally {
    await postgres.disconnect();
  }
  await Promise.all([configPath, updatesPath, notificationsPath, runtimeCachePath].map((path) => rm(path, { force: true })));
}

async function main() {
  await cleanup();
  await writeMockConfig();
  await seedUser(users.member, 'member', 'UI Member');
  await seedUser(users.coordinator, 'organizer', 'UI Coordinator');
  await seedUser(users.coordA, 'organizer', 'UI Coordinator A');
  await seedUser(users.coordC, 'organizer', 'UI Coordinator C');
  await seedUser(users.coordD, 'organizer', 'UI Coordinator D');
  await seedUser(users.memberA, 'member', 'UI Member A');
  await seedUser(users.memberB, 'member', 'UI Member B');
  await seedUser(users.memberC, 'member', 'UI Member C');
  await seedUser(users.pi, 'pi', 'UI PI');
  await seedUser(users.admin, 'administrator', 'UI Admin');

  const server = startServer();
  try {
    await waitForServer(server, baseUrl, 80);
    const browser = await chromium.launch({ headless: true });
    try {
      await checkMember(browser);
      await checkCoordinator(browser);
      await checkPlanningOnly(browser, users.pi);
      await checkAdminMember(browser);
    } finally {
      await browser.close();
    }
    console.log('Theme meeting Playwright UI check passed.');
    console.log(
      JSON.stringify(
        {
          member: users.member,
          coordinator: users.coordinator,
          pi: users.pi,
          admin: users.admin,
          baseUrl,
          restoredOnExit: true,
        },
        null,
        2,
      ),
    );
  } finally {
    await stopServer(server);
    await cleanup();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
