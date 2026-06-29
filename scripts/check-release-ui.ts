import 'dotenv/config';
import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { chromium, getFreePort, startNextServer, stopServer, waitForServer } from './lib/playwright-smoke';
import { createProject } from '../src/mastra/db/projects';
import { createPostgresClient } from '../src/mastra/db/postgres';
import { getUserByUsername, upsertLocalUser, type AuthUser, type UserRole } from '../src/mastra/db/users';
import { saveChatTurn, shareChatSessionWithMentions } from '../src/mastra/db/chat';

const password = 'ReleaseUi1!';
const stamp = Date.now().toString(36);
const runDir = join(tmpdir(), 'vioscope-agent-smoke', `release-ui-${stamp}`);
const configPath = join(runDir, 'theme-meeting-config.yaml');
const updatesPath = join(runDir, 'theme-meeting-updates.yaml');
const notificationsPath = join(runDir, 'theme-meeting-notifications.yaml');
const projectSlug = `release-ui-project-${stamp}`;
const projectTitle = `Release UI Project ${stamp}`;
const sessionId = `release-ui-chat-${stamp}`;
const sharedPrompt = `Please review the release UI smoke @release.ui.receiver.${stamp}`;
const users = {
  owner: `release.ui.owner.${stamp}`,
  receiver: `release.ui.receiver.${stamp}`,
  coordinator: `release.ui.coord.${stamp}`,
  pi: `release.ui.pi.${stamp}`,
  admin: `release.ui.admin.${stamp}`,
};
const originalThemeEnv = {
  config: process.env.THEME_MEETING_CONFIG_PATH,
  updates: process.env.THEME_MEETING_UPDATES_PATH,
  notifications: process.env.THEME_MEETING_NOTIFICATIONS_PATH,
};

function email(username: string): string {
  return `${username}@example.test`;
}

async function seedUser(username: string, role: UserRole): Promise<AuthUser> {
  await upsertLocalUser({
    username,
    role,
    email: email(username),
    password,
    displayName: username,
    passwordResetRequired: false,
    source: 'release_ui_check',
    metadata: { temporary_release_ui_check: true },
  });
  const user = await getUserByUsername(username);
  assert.ok(user, `Expected ${username} to exist.`);
  return user;
}

function configYaml() {
  return `timezone: Europe/London
cycle:
  weekday: Wednesday
  rotation:
    - AB
  anchor_date: 2026-07-01
pi_users:
  - ${users.pi}
administrator_user: ${users.admin}
themes:
  - theme_id: A
    title: Release Theme A
    cycle_group: AB
    weekday: Wednesday
    time: "10:00"
    duration_minutes: 60
    coordinator: Release Coordinator
    coordinator_user: ${users.coordinator}
    members:
      - Release UI Member
    member_users:
      - ${users.receiver}
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
permissions: {}
`;
}

async function writeThemeConfig() {
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, configYaml(), 'utf8');
}

function serverEnv() {
  return {
    ...process.env,
    THEME_MEETING_CONFIG_PATH: configPath,
    THEME_MEETING_UPDATES_PATH: updatesPath,
    THEME_MEETING_NOTIFICATIONS_PATH: notificationsPath,
  };
}

async function login(page: any, baseUrl: string) {
  await page.goto(baseUrl);
  await page.getByLabel('Username').fill(users.receiver);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByText('Briefing').first().waitFor({ state: 'visible', timeout: 15_000 });
}

async function checkBriefing(page: any) {
  await page.getByText(projectTitle).waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByText('Release Theme A').waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByText('Active projects', { exact: true }).waitFor({ state: 'visible' });
  await page.getByText('Need attention', { exact: true }).waitFor({ state: 'visible' });
}

async function checkAlertClickThrough(page: any) {
  await page.getByRole('button', { name: 'View alerts' }).click();
  await page.getByText('Alerts').first().waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByRole('button', { name: 'Open chat' }).first().click();
  await page.getByText('Wiki assistant').first().waitFor({ state: 'visible', timeout: 15_000 });
  await page.locator('.user-bubble').filter({ hasText: sharedPrompt }).waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByRole('tab', { name: 'Shared' }).waitFor({ state: 'visible' });
  await page.getByLabel('Remove shared chat session').click();
  const dialog = page.getByRole('dialog', { name: 'Remove shared session?' });
  await dialog.waitFor({ state: 'visible', timeout: 15_000 });
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden', timeout: 15_000 });
}

async function seedData() {
  await writeThemeConfig();
  const owner = await seedUser(users.owner, 'member');
  const receiver = await seedUser(users.receiver, 'member');
  await seedUser(users.coordinator, 'organizer');
  await seedUser(users.pi, 'pi');
  await seedUser(users.admin, 'administrator');
  await createProject({
    project: projectSlug,
    title: projectTitle,
    ownerUsername: receiver.username,
    track: 'A',
    stage: 2,
    stageProgress: 40,
    lifecycle: 'active',
    status: 'blocked',
    blocker: 'Release smoke wants this project visible in attention flow.',
    target: 'Ship v0.1 release hardening.',
    venue: 'VioScope v0.1',
    submissionDeadline: '2026-07-15',
  }, receiver);
  await saveChatTurn({
    sessionId,
    actor: owner,
    userText: sharedPrompt,
    assistantText: 'Shared for release UI smoke.',
    assistantStatus: 'answer',
    sources: [],
  });
  await shareChatSessionWithMentions({ sessionId, actor: owner, message: sharedPrompt });
}

async function cleanup() {
  const postgres = createPostgresClient('release-ui-cleanup');
  try {
    await postgres.pool.query('DELETE FROM chat_sessions WHERE id = $1', [sessionId]).catch(() => undefined);
    await postgres.pool.query('DELETE FROM project_records WHERE slug = $1', [projectSlug]).catch(() => undefined);
    await postgres.pool.query('DELETE FROM audit_log WHERE actor_username LIKE $1', ['release.ui.%']).catch(() => undefined);
    await postgres.pool.query('DELETE FROM users WHERE username LIKE $1', ['release.ui.%']).catch(() => undefined);
  } finally {
    await postgres.disconnect();
  }
  await rm(runDir, { recursive: true, force: true });
  if (originalThemeEnv.config === undefined) delete process.env.THEME_MEETING_CONFIG_PATH;
  else process.env.THEME_MEETING_CONFIG_PATH = originalThemeEnv.config;
  if (originalThemeEnv.updates === undefined) delete process.env.THEME_MEETING_UPDATES_PATH;
  else process.env.THEME_MEETING_UPDATES_PATH = originalThemeEnv.updates;
  if (originalThemeEnv.notifications === undefined) delete process.env.THEME_MEETING_NOTIFICATIONS_PATH;
  else process.env.THEME_MEETING_NOTIFICATIONS_PATH = originalThemeEnv.notifications;
}

async function main() {
  await cleanup();
  await seedData();
  process.env.THEME_MEETING_CONFIG_PATH = configPath;
  process.env.THEME_MEETING_UPDATES_PATH = updatesPath;
  process.env.THEME_MEETING_NOTIFICATIONS_PATH = notificationsPath;

  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  let server: ReturnType<typeof startNextServer> | null = null;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;

  try {
    server = startNextServer({ port, mode: 'start', env: serverEnv() });
    await waitForServer(server, baseUrl);
    browser = await chromium.launch();
    const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const desktopPage = await desktop.newPage();
    await login(desktopPage, baseUrl);
    await checkBriefing(desktopPage);
    await checkAlertClickThrough(desktopPage);
    await desktop.close();

    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
    const mobilePage = await mobile.newPage();
    await login(mobilePage, baseUrl);
    await checkBriefing(mobilePage);
    await mobile.close();

    console.log('Release UI check passed.');
    console.log(JSON.stringify({ alertClickThrough: true, briefingData: true, mobileLoginBriefing: true }, null, 2));
  } finally {
    await browser?.close().catch(() => undefined);
    await stopServer(server);
    await cleanup();
  }
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  await cleanup().catch(() => undefined);
  process.exitCode = 1;
});
