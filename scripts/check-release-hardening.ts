import 'dotenv/config';
import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createSessionToken, sessionCookieName } from '../src/mastra/auth/session';
import { createPostgresClient } from '../src/mastra/db/postgres';
import { getUserByUsername, upsertLocalUser, type AuthUser, type UserRole } from '../src/mastra/db/users';
import { buildThemeMeetingPlan, submitThemeMeetingUpdate } from '../src/mastra/theme-meetings/planner';

const stamp = Date.now().toString(36);
const runDir = join(tmpdir(), 'vioscope-agent-smoke', `release-hardening-${stamp}`);
const configPath = join(runDir, 'theme-meeting-config.yaml');
const updatesPath = join(runDir, 'theme-meeting-updates.yaml');
const notificationsPath = join(runDir, 'theme-meeting-notifications.yaml');
const meetingDate = '2026-07-01';
const password = 'ReleaseHardening1!';
const users = {
  coordinator: `release.hardening.coord.${stamp}`,
  submitted: `release.hardening.submitted.${stamp}`,
  missing: `release.hardening.missing.${stamp}`,
  pi: `release.hardening.pi.${stamp}`,
  admin: `release.hardening.admin.${stamp}`,
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
    source: 'release_hardening_check',
    metadata: { temporary_release_hardening_check: true },
  });
  const user = await getUserByUsername(username);
  assert.ok(user, `Expected ${username} to exist.`);
  return user;
}

async function setProvisioningStatus(username: string, status: 'active' | 'disabled') {
  const postgres = createPostgresClient('release-hardening-set-user-status');
  try {
    await postgres.pool.query('UPDATE users SET provisioning_status = $2, updated_at = now() WHERE username = $1', [username, status]);
  } finally {
    await postgres.disconnect();
  }
}

function configYaml(memberUsers: string[] = [users.submitted, users.missing]) {
  return `timezone: Europe/London
cycle:
  weekday: Wednesday
  rotation:
    - AB
  anchor_date: ${meetingDate}
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
      - Submitted Member
      - Missing Member
    member_users:
${memberUsers.map((username) => `      - ${username}`).join('\n')}
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

function request(path: string, user: AuthUser, body: Record<string, unknown>): Request {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: `${sessionCookieName}=${createSessionToken(user)}`,
    },
    body: JSON.stringify(body),
  });
}

async function writeConfig(memberUsers?: string[]) {
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, configYaml(memberUsers), 'utf8');
}

function applyThemeEnv() {
  process.env.THEME_MEETING_CONFIG_PATH = configPath;
  process.env.THEME_MEETING_UPDATES_PATH = updatesPath;
  process.env.THEME_MEETING_NOTIFICATIONS_PATH = notificationsPath;
}

function restoreThemeEnv() {
  if (originalThemeEnv.config === undefined) delete process.env.THEME_MEETING_CONFIG_PATH;
  else process.env.THEME_MEETING_CONFIG_PATH = originalThemeEnv.config;
  if (originalThemeEnv.updates === undefined) delete process.env.THEME_MEETING_UPDATES_PATH;
  else process.env.THEME_MEETING_UPDATES_PATH = originalThemeEnv.updates;
  if (originalThemeEnv.notifications === undefined) delete process.env.THEME_MEETING_NOTIFICATIONS_PATH;
  else process.env.THEME_MEETING_NOTIFICATIONS_PATH = originalThemeEnv.notifications;
}

async function cleanup() {
  const postgres = createPostgresClient('release-hardening-cleanup');
  try {
    await postgres.pool.query('DELETE FROM audit_log WHERE actor_username LIKE $1', ['release.hardening.%']).catch(() => undefined);
    await postgres.pool.query('DELETE FROM users WHERE username LIKE $1', ['release.hardening.%']).catch(() => undefined);
  } finally {
    await postgres.disconnect();
  }
  await rm(runDir, { recursive: true, force: true });
  restoreThemeEnv();
}

async function main() {
  await cleanup();
  const coordinator = await seedUser(users.coordinator, 'organizer');
  await seedUser(users.submitted, 'member');
  await seedUser(users.missing, 'member');
  await seedUser(users.pi, 'pi');
  await seedUser(users.admin, 'administrator');
  applyThemeEnv();

  try {
    await writeConfig([users.submitted, `release.hardening.missing.user.${stamp}`]);
    await assert.rejects(
      () => buildThemeMeetingPlan({ configPath, updatesPath, notificationsPath, meetingDate, validateUsers: true }),
      /missing users/i,
      'Theme config should reject missing account references.',
    );

    await writeConfig();
    await setProvisioningStatus(users.missing, 'disabled');
    await assert.rejects(
      () => buildThemeMeetingPlan({ configPath, updatesPath, notificationsPath, meetingDate, validateUsers: true }),
      /inactive users/i,
      'Theme config should reject inactive account references.',
    );
    await setProvisioningStatus(users.missing, 'active');

    await submitThemeMeetingUpdate({
      configPath,
      updatesPath,
      notificationsPath,
      meetingDate,
      themeId: 'A',
      member: users.submitted,
      updateType: 'milestone_check',
      progressText: 'Completed the release hardening pass and ready to discuss remaining risks.',
      submittedVia: 'api',
      validateUsers: true,
      now: new Date('2026-06-30T09:00:00.000Z'),
    });

    const remindersRoute = await import('../app/api/theme-meetings/reminders/route');
    const reminderResponse = await remindersRoute.POST(
      request('/api/theme-meetings/reminders', coordinator, {
        action: 'manual_missing_update_reminder',
        themeId: 'A',
        meetingDate,
      }),
    );
    const reminderBody = await reminderResponse.json();
    assert.equal(reminderResponse.status, 200, 'Coordinator should send manual missing-update reminder.');
    assert.equal(reminderBody.notifications?.length, 1, 'Manual reminder should target exactly one missing member.');
    assert.equal(reminderBody.notifications?.[0]?.member_username, users.missing);

    console.log('Release hardening check passed.');
    console.log(JSON.stringify({ missingUserRejected: true, inactiveUserRejected: true, manualReminderCount: 1 }, null, 2));
  } finally {
    await cleanup();
  }
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  await cleanup().catch(() => undefined);
  process.exitCode = 1;
});
