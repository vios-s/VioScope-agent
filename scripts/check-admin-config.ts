import 'dotenv/config';
import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createSessionToken, sessionCookieName } from '../src/mastra/auth/session';
import { auditLogDateKey } from '../src/mastra/db/audit-log';
import { createPostgresClient } from '../src/mastra/db/postgres';
import { getUserByUsername, upsertLocalUser, type AuthUser, type UserRole } from '../src/mastra/db/users';
import { runtimeConfigCachePath } from '../src/mastra/runtime-config';

type SettingSnapshot = {
  key: string;
  value: string | null;
};

const testRunId = `admin-config-smoke-${Date.now()}`;
const users = {
  admin: { username: `config.smoke.admin.${Date.now()}`, role: 'administrator' as const, password: 'ConfigAdmin1!' },
  member: { username: `config.smoke.member.${Date.now()}`, role: 'member' as const, password: 'ConfigMember1!' },
};
const settingKeys = [
  'WIKI_MIN_SCORE',
  'AUDIT_LOG_RETENTION_DAYS',
];
const themeMeetingConfigOnlyKeys = [
  'THEME_MEETING_FIRST_REMINDER_WEEKDAY',
  'THEME_MEETING_FIRST_REMINDER_TIME',
  'THEME_MEETING_GENTLE_REMINDER_WEEKDAY',
  'THEME_MEETING_GENTLE_REMINDER_TIME',
  'THEME_MEETING_CUTOFF_WEEKDAY',
  'THEME_MEETING_CUTOFF_TIME',
];

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
    source: 'admin_config_check',
  });
  const user = await getUserByUsername(input.username);
  assert.ok(user, `Expected ${input.username} to exist.`);
  return user;
}

function request(path: string, user: AuthUser, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set('cookie', `${sessionCookieName}=${createSessionToken(user)}`);
  if (init.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  return new Request(`http://localhost${path}`, { ...init, headers });
}

async function snapshotSettings(): Promise<SettingSnapshot[]> {
  const postgres = createPostgresClient('admin-config-snapshot');

  try {
    const result = await postgres.pool.query<{ key: string; value: string }>(
      'SELECT key, value FROM app_settings WHERE key = ANY($1::text[])',
      [settingKeys],
    ).catch((): { rows: Array<{ key: string; value: string }> } => ({ rows: [] }));
    const rows = new Map<string, string>();
    for (const row of result.rows) {
      rows.set(row.key, row.value);
    }
    return settingKeys.map((key): SettingSnapshot => ({ key, value: rows.get(key) ?? null }));
  } finally {
    await postgres.disconnect();
  }
}

async function restoreSettings(snapshots: SettingSnapshot[]): Promise<void> {
  const postgres = createPostgresClient('admin-config-restore');

  try {
    for (const snapshot of snapshots) {
      if (snapshot.value === null) {
        await postgres.pool.query('DELETE FROM app_settings WHERE key = $1', [snapshot.key]).catch(() => undefined);
      } else {
        await postgres.pool.query(
          `
            INSERT INTO app_settings (key, value, updated_at)
            VALUES ($1, $2, now())
            ON CONFLICT (key) DO UPDATE
            SET value = EXCLUDED.value,
                updated_at = now()
          `,
          [snapshot.key, snapshot.value],
        );
      }
    }
  } finally {
    await postgres.disconnect();
  }
}

async function snapshotRuntimeConfigCache(): Promise<string | null> {
  try {
    return await readFile(runtimeConfigCachePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function restoreRuntimeConfigCache(snapshot: string | null): Promise<void> {
  if (snapshot === null) {
    await rm(runtimeConfigCachePath, { force: true });
    return;
  }

  await mkdir(dirname(runtimeConfigCachePath), { recursive: true });
  await writeFile(runtimeConfigCachePath, snapshot, { mode: 0o600 });
}

async function readRuntimeSettings(): Promise<Record<string, string>> {
  try {
    const parsed = JSON.parse(await readFile(runtimeConfigCachePath, 'utf8'));
    return parsed?.settings && typeof parsed.settings === 'object' ? parsed.settings : {};
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {};
    }
    throw error;
  }
}

async function cleanup(): Promise<void> {
  const postgres = createPostgresClient('admin-config-cleanup');

  try {
    await postgres.pool.query("DELETE FROM audit_log WHERE metadata->>'testRunId' = $1", [testRunId]).catch(() => undefined);
    await postgres.pool.query('DELETE FROM users WHERE username = ANY($1::text[])', [
      [users.admin.username, users.member.username],
    ]);
  } finally {
    await postgres.disconnect();
  }
}

function findSetting(payload: any, key: string) {
  const setting = payload.settings?.find((item: { key: string }) => item.key === key);
  assert.ok(setting, `Expected ${key} setting.`);
  return setting;
}

function hasSetting(payload: any, key: string): boolean {
  return Boolean(payload.settings?.some((item: { key: string }) => item.key === key));
}

async function main() {
  process.env.VIOSCOPE_AUDIT_TEST_RUN_ID = testRunId;
  const snapshots = await snapshotSettings();
  const runtimeCacheSnapshot = await snapshotRuntimeConfigCache();
  const admin = await seedUser(users.admin);
  const member = await seedUser(users.member);

  try {
    const configRoute = await import('../app/api/admin/config/route');
    const restartRoute = await import('../app/api/admin/config/restart/route');
    const auditRoute = await import('../app/api/audit-log/route');

    const memberConfig = await configRoute.GET(request('/api/admin/config', member));
    assert.equal(memberConfig.status, 403, 'Member should not read admin config.');

    const initialResponse = await configRoute.GET(request('/api/admin/config', admin));
    assert.equal(initialResponse.status, 200, 'Admin should read config.');
    const initialPayload = await initialResponse.json();
    assert.equal(initialPayload.secrets, undefined, 'Admin config should not include a secrets section.');
    for (const key of themeMeetingConfigOnlyKeys) {
      assert.equal(hasSetting(initialPayload, key), false, `${key} should live only in Settings -> Theme meeting.`);
    }

    const wikiMinScore = findSetting(initialPayload, 'WIKI_MIN_SCORE');
    const originalWikiValue = wikiMinScore.value;
    const nextWikiValue = originalWikiValue === '0.36' ? '0.35' : '0.36';

    const changedResponse = await configRoute.PATCH(
      request('/api/admin/config', admin, {
        method: 'PATCH',
        body: JSON.stringify({ settings: { WIKI_MIN_SCORE: nextWikiValue } }),
      }),
    );
    assert.equal(changedResponse.status, 200, 'Admin should update WIKI_MIN_SCORE.');
    const changedPayload = await changedResponse.json();
    assert.equal(findSetting(changedPayload, 'WIKI_MIN_SCORE').value, nextWikiValue);
    assert.equal(findSetting(changedPayload, 'WIKI_MIN_SCORE').source, 'database');
    assert.equal((await readRuntimeSettings()).WIKI_MIN_SCORE, nextWikiValue, 'Runtime cache should contain changed WIKI_MIN_SCORE.');

    const originalWikiStored = snapshots.find((snapshot) => snapshot.key === 'WIKI_MIN_SCORE')?.value ?? null;
    const revertedWikiResponse = await configRoute.PATCH(
      request('/api/admin/config', admin, {
        method: 'PATCH',
        body: JSON.stringify({ settings: { WIKI_MIN_SCORE: originalWikiStored } }),
      }),
    );
    assert.equal(revertedWikiResponse.status, 200, 'Admin should revert WIKI_MIN_SCORE.');
    const revertedWikiPayload = await revertedWikiResponse.json();
    assert.equal(findSetting(revertedWikiPayload, 'WIKI_MIN_SCORE').value, originalWikiValue);
    const revertedRuntimeSettings = await readRuntimeSettings();
    assert.equal(revertedRuntimeSettings.WIKI_MIN_SCORE, originalWikiStored ?? undefined);

    const retentionResponse = await configRoute.PATCH(
      request('/api/admin/config', admin, {
        method: 'PATCH',
        body: JSON.stringify({ settings: { AUDIT_LOG_RETENTION_DAYS: '30' } }),
      }),
    );
    assert.equal(retentionResponse.status, 200, 'Admin should update AUDIT_LOG_RETENTION_DAYS.');
    const retentionPayload = await retentionResponse.json();
    assert.equal(findSetting(retentionPayload, 'AUDIT_LOG_RETENTION_DAYS').value, '30');
    assert.equal(findSetting(retentionPayload, 'AUDIT_LOG_RETENTION_DAYS').source, 'database');

    const duplicateThemeSettingResponse = await configRoute.PATCH(
      request('/api/admin/config', admin, {
        method: 'PATCH',
        body: JSON.stringify({ settings: { THEME_MEETING_CUTOFF_TIME: '09:30' } }),
      }),
    );
    assert.equal(duplicateThemeSettingResponse.status, 400, 'Theme meeting schedule settings should not be editable in admin config.');

    const retentionStored = snapshots.find((snapshot) => snapshot.key === 'AUDIT_LOG_RETENTION_DAYS')?.value ?? null;
    const resetRetentionResponse = await configRoute.PATCH(
      request('/api/admin/config', admin, {
        method: 'PATCH',
        body: JSON.stringify({ settings: { AUDIT_LOG_RETENTION_DAYS: retentionStored } }),
      }),
    );
    assert.equal(resetRetentionResponse.status, 200, 'Admin should restore AUDIT_LOG_RETENTION_DAYS.');

    const restartResponse = await restartRoute.POST(request('/api/admin/config/restart', admin, { method: 'POST' }));
    const expectedRestartStatus = process.env.VIOSCOPE_RESTART_COMMAND?.trim() ? 200 : 409;
    assert.equal(restartResponse.status, expectedRestartStatus, 'Restart status should match VIOSCOPE_RESTART_COMMAND availability.');

    const auditDay = auditLogDateKey();
    const auditResponse = await auditRoute.GET(request(`/api/audit-log?day=${auditDay}`, admin));
    assert.equal(auditResponse.status, 200, 'Admin should read audit logs.');
    const auditPayload = await auditResponse.json();
    const actions = new Set(
      (auditPayload.logs || [])
        .filter((log: { metadata: Record<string, unknown> }) => log.metadata?.testRunId === testRunId)
        .map((log: { action: string }) => log.action),
    );
    assert.ok(actions.has('admin.config_update'), 'Config updates should be audited.');
    assert.ok(
      actions.has(process.env.VIOSCOPE_RESTART_COMMAND?.trim() ? 'admin.restart_requested' : 'admin.restart_unavailable'),
      'Restart request should be audited.',
    );

    console.log('Admin config check passed.');
    console.log(JSON.stringify({ changed: 'WIKI_MIN_SCORE', reset: 'AUDIT_LOG_RETENTION_DAYS', auditActions: [...actions] }, null, 2));
  } finally {
    await restoreSettings(snapshots);
    await restoreRuntimeConfigCache(runtimeCacheSnapshot);
    await cleanup();
    delete process.env.VIOSCOPE_AUDIT_TEST_RUN_ID;
  }
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
