import 'dotenv/config';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createSessionToken, sessionCookieName } from '../src/mastra/auth/session';
import { createPostgresClient } from '../src/mastra/db/postgres';
import { getUserByUsername, upsertLocalUser, type AuthUser } from '../src/mastra/db/users';

const execFileAsync = promisify(execFile);
const testRunId = `service-restart-smoke-${Date.now()}`;
const adminUsername = `restart.smoke.admin.${Date.now()}`;

function email(username: string): string {
  return `${username}@example.test`;
}

async function seedAdmin(): Promise<AuthUser> {
  await upsertLocalUser({
    username: adminUsername,
    email: email(adminUsername),
    password: 'RestartAdmin1!',
    role: 'administrator',
    displayName: adminUsername,
    source: 'service_restart_check',
  });
  const user = await getUserByUsername(adminUsername);
  assert.ok(user, 'Expected restart smoke admin to exist.');
  return user;
}

async function cleanup(): Promise<void> {
  const postgres = createPostgresClient('service-restart-cleanup');

  try {
    await postgres.pool.query("DELETE FROM audit_log WHERE metadata->>'testRunId' = $1 OR actor_username = $2", [
      testRunId,
      adminUsername,
    ]).catch(() => undefined);
    await postgres.pool.query('DELETE FROM users WHERE username = $1', [adminUsername]).catch(() => undefined);
  } finally {
    await postgres.disconnect();
  }
}

async function serviceIsActive(): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('systemctl', ['--user', 'is-active', 'vioscope-web.service']);
    return stdout.trim() === 'active';
  } catch {
    return false;
  }
}

async function waitForService(): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (await serviceIsActive()) {
      try {
        const response = await fetch('http://localhost:3000/api/auth/me');
        if (response.status < 500) {
          return;
        }
      } catch {
        // Retry while systemd finishes restart.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('vioscope-web.service did not become reachable after restart.');
}

async function restartAuditExists(): Promise<boolean> {
  const postgres = createPostgresClient('service-restart-audit');

  try {
    const result = await postgres.pool.query(
      `
        SELECT 1
        FROM audit_log
        WHERE action = 'admin.restart_requested'
          AND actor_username = $1
        LIMIT 1
      `,
      [adminUsername],
    );
    return (result.rowCount ?? 0) > 0;
  } finally {
    await postgres.disconnect();
  }
}

async function main() {
  if (!process.env.VIOSCOPE_RESTART_COMMAND?.trim()) {
    throw new Error('VIOSCOPE_RESTART_COMMAND is not configured.');
  }

  process.env.VIOSCOPE_AUDIT_TEST_RUN_ID = testRunId;
  const admin = await seedAdmin();

  try {
    const response = await fetch('http://localhost:3000/api/admin/config/restart', {
      method: 'POST',
      headers: {
        cookie: `${sessionCookieName}=${createSessionToken(admin)}`,
      },
    });
    const body = (await response.json()) as { ok?: boolean; error?: string };
    assert.equal(response.status, 200, body.error || 'Restart request should succeed.');
    assert.equal(body.ok, true, 'Restart request should return ok.');

    await waitForService();
    assert.equal(await restartAuditExists(), true, 'Restart request should be audited.');

    console.log('Service restart check passed.');
    console.log(JSON.stringify({ service: 'vioscope-web.service', active: true }, null, 2));
  } finally {
    await cleanup();
    delete process.env.VIOSCOPE_AUDIT_TEST_RUN_ID;
  }
}

main().catch(async (error) => {
  await cleanup().catch(() => undefined);
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
