import 'dotenv/config';
import assert from 'node:assert/strict';
import { createSessionToken, sessionCookieName } from '../src/mastra/auth/session';
import { ensureAuditLogTable } from '../src/mastra/db/audit-log';
import { createPostgresClient } from '../src/mastra/db/postgres';
import { getUserByUsername, upsertLocalUser, type AuthUser, type UserRole } from '../src/mastra/db/users';

const testRunId = `audit-log-smoke-${Date.now()}`;
const previousDay = '2026-06-21';
const users = {
  admin: { username: `audit.smoke.admin.${Date.now()}`, role: 'administrator' as const, password: 'AuditAdmin1!' },
  member: { username: `audit.smoke.member.${Date.now()}`, role: 'member' as const, password: 'AuditMember1!' },
};

function email(username: string): string {
  return `${username}@example.test`;
}

async function seedUser(input: { username: string; role: UserRole; password: string }): Promise<AuthUser> {
  await upsertLocalUser({
    username: input.username,
    email: email(input.username),
    password: input.password,
    role: input.role,
    displayName: input.username,
    source: 'audit_log_check',
  });
  const user = await getUserByUsername(input.username);
  assert.ok(user, `Expected ${input.username} to exist.`);
  return user;
}

function getRequest(path: string, user: AuthUser): Request {
  return new Request(`http://localhost${path}`, {
    headers: { cookie: `${sessionCookieName}=${createSessionToken(user)}` },
  });
}

async function insertMockPreviousLog(admin: AuthUser): Promise<string> {
  await ensureAuditLogTable();
  const postgres = createPostgresClient('audit-log-smoke-insert');

  try {
    const result = await postgres.pool.query<{ id: string }>(
      `
        INSERT INTO audit_log (
          event_time,
          event_day,
          actor_user_id,
          actor_username,
          actor_role,
          action,
          target_type,
          target_id,
          summary,
          metadata
        )
        VALUES (
          $1::timestamptz,
          $2::date,
          $3::uuid,
          $4,
          $5,
          'audit.mock_previous_day',
          'audit_log',
          $6,
          'Mock previous-day audit log for smoke test.',
          $7::jsonb
        )
        RETURNING id::text
      `,
      [
        `${previousDay}T12:00:00.000Z`,
        previousDay,
        admin.id,
        admin.username,
        admin.role,
        testRunId,
        JSON.stringify({ testRunId, purpose: 'previous_day_readback' }),
      ],
    );
    return result.rows[0]?.id || '';
  } finally {
    await postgres.disconnect();
  }
}

async function cleanup(): Promise<void> {
  const postgres = createPostgresClient('audit-log-smoke-cleanup');

  try {
    await postgres.pool.query("DELETE FROM audit_log WHERE metadata->>'testRunId' = $1 OR target_id = $1", [testRunId]);
    await postgres.pool.query('DELETE FROM users WHERE username = ANY($1::text[])', [
      [users.admin.username, users.member.username],
    ]);
  } finally {
    await postgres.disconnect();
  }
}

async function main() {
  const admin = await seedUser(users.admin);
  const member = await seedUser(users.member);
  const mockLogId = await insertMockPreviousLog(admin);
  assert.ok(mockLogId, 'Expected mock audit log id.');

  try {
    const auditRoute = await import('../app/api/audit-log/route');

    const memberResponse = await auditRoute.GET(getRequest(`/api/audit-log?day=${previousDay}`, member));
    assert.equal(memberResponse.status, 403, 'Member should not read audit logs.');

    const adminResponse = await auditRoute.GET(getRequest(`/api/audit-log?day=${previousDay}`, admin));
    assert.equal(adminResponse.status, 200, 'Administrator should read previous audit logs.');
    const body = await adminResponse.json();

    assert.equal(body.day, previousDay);
    assert.equal(body.fileName, `audit-${previousDay}.jsonl`);
    assert.ok(
      body.logs.some((log: { id: string; action: string; metadata: Record<string, unknown> }) => (
        log.id === mockLogId &&
        log.action === 'audit.mock_previous_day' &&
        log.metadata.testRunId === testRunId
      )),
      'Previous-day mock log should be readable by day.',
    );
    assert.ok(
      body.days.some((day: { day: string; fileName: string; count: number }) => (
        day.day === previousDay &&
        day.fileName === `audit-${previousDay}.jsonl` &&
        day.count >= 1
      )),
      'Available log file list should include previous-day log.',
    );

    console.log('Audit log readback check passed.');
    console.log(JSON.stringify({ previousDay, mockLogId, listedDays: body.days.length }, null, 2));
  } finally {
    await cleanup();
  }
}

main().catch(async (error) => {
  await cleanup().catch(() => undefined);
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
