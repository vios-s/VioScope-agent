import 'dotenv/config';
import assert from 'node:assert/strict';
import { copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createSessionToken, sessionCookieName } from '../src/mastra/auth/session';
import { createPostgresClient } from '../src/mastra/db/postgres';
import {
  ensureUsersTable,
  getUserByUsername,
  upsertLocalUser,
  type AuthUser,
  type UserRole,
} from '../src/mastra/db/users';

type SnapshotRow = {
  id: string;
  username: string;
  display_name: string;
  email: string;
  role: string;
  password_hash: string | null;
  password_reset_required: boolean;
  password_changed_at: string | null;
  last_login_at: string | null;
  auth_provider: string;
  provisioning_status: string;
  source: string;
  source_url: string | null;
  source_profile_id: string | null;
  metadata: string;
  created_at: string;
  updated_at: string;
};

type UserSnapshot = {
  username: string;
  row: SnapshotRow | null;
};

type TestUser = {
  username: string;
  role: UserRole;
};

const configPath = join(tmpdir(), 'vioscope-agent-smoke', 'theme-meeting-auth-config.yaml');
const updatesPath = join(tmpdir(), 'vioscope-agent-smoke', 'theme-meeting-auth-updates.yaml');
const notificationsPath = join(tmpdir(), 'vioscope-agent-smoke', 'theme-meeting-auth-notifications.yaml');
const temporaryPassword = 'ThemeCheck1!';

const coordinators = [
  { themeId: 'A', username: 'coordinator.a', meetingDate: '2026-06-24', otherThemeId: 'B', addCandidate: 'carla' },
  { themeId: 'B', username: 'coordinator.b', meetingDate: '2026-06-24', otherThemeId: 'A', addCandidate: 'alice' },
  { themeId: 'C', username: 'coordinator.c', meetingDate: '2026-07-01', otherThemeId: 'D', addCandidate: 'gabe' },
  { themeId: 'D', username: 'coordinator.d', meetingDate: '2026-07-01', otherThemeId: 'C', addCandidate: 'erin' },
] as const;

const temporaryUsers: TestUser[] = [
  ...coordinators.map((coordinator) => ({ username: coordinator.username, role: 'organizer' as const })),
  { username: 'alice', role: 'member' },
  { username: 'carla', role: 'member' },
  { username: 'erin', role: 'member' },
  { username: 'gabe', role: 'member' },
];

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

async function snapshotUsers(usernames: string[]): Promise<Map<string, UserSnapshot>> {
  await ensureUsersTable();
  const postgres = createPostgresClient('theme-meeting-auth-check');

  try {
    const result = await postgres.pool.query<SnapshotRow>(
      `
        SELECT
          id::text,
          username,
          display_name,
          email,
          role,
          password_hash,
          password_reset_required,
          password_changed_at::text,
          last_login_at::text,
          auth_provider,
          provisioning_status,
          source,
          source_url,
          source_profile_id,
          metadata::text,
          created_at::text,
          updated_at::text
        FROM users
        WHERE username = ANY($1::text[])
      `,
      [usernames],
    );
    const rows = new Map<string, SnapshotRow>(
      (result.rows as SnapshotRow[]).map((row: SnapshotRow) => [row.username, row]),
    );
    return new Map<string, UserSnapshot>(
      usernames.map((username): [string, UserSnapshot] => [username, { username, row: rows.get(username) || null }]),
    );
  } finally {
    await postgres.disconnect();
  }
}

async function restoreUsers(snapshots: Map<string, UserSnapshot>): Promise<void> {
  await ensureUsersTable();
  const postgres = createPostgresClient('theme-meeting-auth-restore');

  try {
    for (const snapshot of snapshots.values()) {
      if (!snapshot.row) {
        await postgres.pool.query('DELETE FROM users WHERE username = $1', [snapshot.username]);
        continue;
      }

      const row = snapshot.row;
      await postgres.pool.query(
        `
          UPDATE users
          SET
            username = $2,
            display_name = $3,
            email = $4,
            role = $5,
            password_hash = $6,
            password_reset_required = $7,
            password_changed_at = $8::timestamptz,
            last_login_at = $9::timestamptz,
            auth_provider = $10,
            provisioning_status = $11,
            source = $12,
            source_url = $13,
            source_profile_id = $14,
            metadata = $15::jsonb,
            created_at = $16::timestamptz,
            updated_at = $17::timestamptz
          WHERE id = $1
        `,
        [
          row.id,
          row.username,
          row.display_name,
          row.email,
          row.role,
          row.password_hash,
          row.password_reset_required,
          row.password_changed_at,
          row.last_login_at,
          row.auth_provider,
          row.provisioning_status,
          row.source,
          row.source_url,
          row.source_profile_id,
          row.metadata,
          row.created_at,
          row.updated_at,
        ],
      );
    }
  } finally {
    await postgres.disconnect();
  }
}

async function cleanupAuditLogs(testRunId: string): Promise<void> {
  const postgres = createPostgresClient('theme-meeting-auth-audit-cleanup');

  try {
    await postgres.pool.query(
      "DELETE FROM audit_log WHERE metadata->>'testRunId' = $1",
      [testRunId],
    );
  } catch {
    // audit_log may not exist if the check failed before audit setup.
  } finally {
    await postgres.disconnect();
  }
}

async function activateTemporaryUsers(snapshots: Map<string, UserSnapshot>): Promise<void> {
  for (const user of temporaryUsers) {
    await upsertLocalUser({
      username: user.username,
      role: user.role,
      email: `${user.username}@example.test`,
      displayName: snapshots.get(user.username)?.row?.display_name || user.username,
      password: temporaryPassword,
      passwordResetRequired: false,
      source: snapshots.get(user.username)?.row?.source || 'theme_meeting_auth_check',
      metadata: { temporary_theme_meeting_auth_check: true },
    });
  }
}

async function activeUser(username: string): Promise<AuthUser> {
  const user = await getUserByUsername(username);
  assert.ok(user, `Expected ${username} to exist.`);
  assert.equal(user.provisioningStatus, 'active', `Expected ${username} to be active.`);
  assert.equal(user.passwordResetRequired, false, `Expected ${username} to be usable without password reset.`);
  return user;
}

function requestFor(user: AuthUser, path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set('cookie', `${sessionCookieName}=${createSessionToken(user)}`);
  if (init.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  return new Request(`http://localhost${path}`, { ...init, headers });
}

function jsonBody(value: unknown): BodyInit {
  return JSON.stringify(value);
}

async function expectJson<T = any>(label: string, response: Response, status = 200): Promise<T> {
  const body = (await response.json()) as T;
  assert.equal(response.status, status, `${label} returned ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

async function main() {
  const auditTestRunId = `theme-meeting-auth-${Date.now()}`;
  process.env.VIOSCOPE_AUDIT_TEST_RUN_ID = auditTestRunId;
  process.env.THEME_MEETING_CONFIG_PATH = configPath;
  process.env.THEME_MEETING_UPDATES_PATH = updatesPath;
  process.env.THEME_MEETING_NOTIFICATIONS_PATH = notificationsPath;

  await copyFile(resolve('fixtures/theme-meeting-config.example.yaml'), resolve(configPath));
  const usernames = unique(temporaryUsers.map((user) => user.username));
  const snapshots = await snapshotUsers(usernames);

  try {
    await rm(resolve(updatesPath), { force: true });
    await rm(resolve(notificationsPath), { force: true });
    await activateTemporaryUsers(snapshots);

    const themeMeetingsRoute = await import('../app/api/theme-meetings/route');
    const remindersRoute = await import('../app/api/theme-meetings/reminders/route');
    const membersRoute = await import('../app/api/theme-meetings/members/route');
    const updatesRoute = await import('../app/api/theme-meetings/updates/route');

    for (const coordinator of coordinators) {
      const user = await activeUser(coordinator.username);
      const dashboard = await expectJson<any>(
        `${coordinator.username} dashboard`,
        await themeMeetingsRoute.GET(requestFor(user, `/api/theme-meetings?date=${coordinator.meetingDate}`)),
      );
      assert.deepEqual(dashboard.access.canManageThemeIds, [coordinator.themeId]);
      assert.deepEqual(
        dashboard.plan.meetings.map((meeting: { theme_id: string }) => meeting.theme_id),
        [coordinator.themeId],
      );

      const reminder = await expectJson<any>(
        `${coordinator.username} own reminder`,
        await remindersRoute.POST(
          requestFor(user, '/api/theme-meetings/reminders', {
            method: 'POST',
            body: jsonBody({
              themeId: coordinator.themeId,
              meetingDate: coordinator.meetingDate,
              action: 'manual_missing_update_reminder',
            }),
          }),
        ),
      );
      assert.ok(reminder.notifications.length > 0, `Expected Theme ${coordinator.themeId} reminder notifications.`);
      assert.ok(
        reminder.notifications.every((notification: { theme_id: string }) => notification.theme_id === coordinator.themeId),
        `Expected only Theme ${coordinator.themeId} notifications.`,
      );

      await expectJson(
        `${coordinator.username} cross-theme reminder blocked`,
        await remindersRoute.POST(
          requestFor(user, '/api/theme-meetings/reminders', {
            method: 'POST',
            body: jsonBody({
              themeId: coordinator.otherThemeId,
              meetingDate: coordinator.meetingDate,
              action: 'manual_missing_update_reminder',
            }),
          }),
        ),
        403,
      );

      const afterAdd = await expectJson<any>(
        `${coordinator.username} add member`,
        await membersRoute.POST(
          requestFor(user, '/api/theme-meetings/members', {
            method: 'POST',
            body: jsonBody({
              themeId: coordinator.themeId,
              meetingDate: coordinator.meetingDate,
              action: 'add',
              username: coordinator.addCandidate,
            }),
          }),
        ),
      );
      assert.ok(
        afterAdd.plan.meetings
          .find((meeting: { theme_id: string }) => meeting.theme_id === coordinator.themeId)
          ?.member_usernames.includes(coordinator.addCandidate),
        `Expected ${coordinator.addCandidate} to be added to Theme ${coordinator.themeId}.`,
      );

      const afterRemove = await expectJson<any>(
        `${coordinator.username} remove member`,
        await membersRoute.POST(
          requestFor(user, '/api/theme-meetings/members', {
            method: 'POST',
            body: jsonBody({
              themeId: coordinator.themeId,
              meetingDate: coordinator.meetingDate,
              action: 'remove',
              username: coordinator.addCandidate,
            }),
          }),
        ),
      );
      assert.equal(
        afterRemove.plan.meetings
          .find((meeting: { theme_id: string }) => meeting.theme_id === coordinator.themeId)
          ?.member_usernames.includes(coordinator.addCandidate),
        false,
        `Expected ${coordinator.addCandidate} to be removed from Theme ${coordinator.themeId}.`,
      );
    }

    const member = await activeUser('alice');
    const memberDashboard = await expectJson<any>(
      'member dashboard',
      await themeMeetingsRoute.GET(requestFor(member, '/api/theme-meetings?date=2026-06-24')),
    );
    assert.deepEqual(memberDashboard.access.canManageThemeIds, []);
    assert.deepEqual(
      memberDashboard.plan.meetings.map((meeting: { theme_id: string }) => meeting.theme_id),
      ['A'],
    );

    const memberUpdate = await expectJson<any>(
      'member own update',
      await updatesRoute.POST(
        requestFor(member, '/api/theme-meetings/updates', {
          method: 'POST',
          body: jsonBody({
            meetingDate: '2026-06-24',
            themeId: 'A',
            member: 'alice',
            updateType: 'short_update',
            progressText: 'Completed a temporary auth smoke test update for the Theme A dashboard path.',
            questions: 'Can the coordinator see this planned short update?',
          }),
        }),
      ),
    );
    assert.equal(memberUpdate.update.member_username, 'alice');

    await expectJson(
      'member submit as another user blocked',
      await updatesRoute.POST(
        requestFor(member, '/api/theme-meetings/updates', {
          method: 'POST',
          body: jsonBody({
            meetingDate: '2026-06-24',
            themeId: 'A',
            member: 'bob',
            updateType: 'nothing_to_report',
            progressText: 'This should not be accepted.',
          }),
        }),
      ),
      403,
    );

    await expectJson(
      'member manage members blocked',
      await membersRoute.POST(
        requestFor(member, '/api/theme-meetings/members', {
          method: 'POST',
          body: jsonBody({
            themeId: 'A',
            meetingDate: '2026-06-24',
            action: 'add',
            username: 'carla',
          }),
        }),
      ),
      403,
    );

    console.log('Theme meeting auth check passed.');
    console.log(
      JSON.stringify(
        {
          temporaryAccounts: usernames,
          coordinatorThemesChecked: coordinators.map((coordinator) => coordinator.themeId),
          memberUpdateChecked: 'alice',
          restoredOnExit: true,
        },
        null,
        2,
      ),
    );
  } finally {
    await rm(resolve(configPath), { force: true });
    await rm(resolve(updatesPath), { force: true });
    await rm(resolve(notificationsPath), { force: true });
    await restoreUsers(snapshots);
    await cleanupAuditLogs(auditTestRunId);
    delete process.env.VIOSCOPE_AUDIT_TEST_RUN_ID;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
