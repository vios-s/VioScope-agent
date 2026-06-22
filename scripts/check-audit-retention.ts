import 'dotenv/config';
import assert from 'node:assert/strict';
import { ensureAuditLogTable, pruneAuditLogs } from '../src/mastra/db/audit-log';
import { ensureAppSettingsTable } from '../src/mastra/db/app-settings';
import { createPostgresClient } from '../src/mastra/db/postgres';

const testRunId = `audit-retention-smoke-${Date.now()}`;

async function snapshotRetention(): Promise<string | null> {
  await ensureAppSettingsTable();
  const postgres = createPostgresClient('audit-retention-snapshot');

  try {
    const result = await postgres.pool.query<{ value: string }>(
      'SELECT value FROM app_settings WHERE key = $1',
      ['AUDIT_LOG_RETENTION_DAYS'],
    );
    return result.rows[0]?.value ?? null;
  } finally {
    await postgres.disconnect();
  }
}

async function setRetention(value: string | null): Promise<void> {
  await ensureAppSettingsTable();
  const postgres = createPostgresClient('audit-retention-set');

  try {
    if (value === null) {
      await postgres.pool.query('DELETE FROM app_settings WHERE key = $1', ['AUDIT_LOG_RETENTION_DAYS']);
      return;
    }
    await postgres.pool.query(
      `
        INSERT INTO app_settings (key, value, updated_at)
        VALUES ($1, $2, now())
        ON CONFLICT (key) DO UPDATE
        SET value = EXCLUDED.value,
            updated_at = now()
      `,
      ['AUDIT_LOG_RETENTION_DAYS', value],
    );
  } finally {
    await postgres.disconnect();
  }
}

async function insertLogs(): Promise<{ oldId: string; currentId: string }> {
  await ensureAuditLogTable();
  const postgres = createPostgresClient('audit-retention-insert');

  try {
    const result = await postgres.pool.query<{ id: string; target_id: string }>(
      `
        INSERT INTO audit_log (event_time, event_day, action, target_type, target_id, summary, metadata)
        VALUES
          ('2000-01-01T00:00:00Z'::timestamptz, '2000-01-01'::date, 'audit.retention_old', 'audit_log', $1, 'Old retention smoke log.', $3::jsonb),
          (now(), (now() AT TIME ZONE 'Europe/London')::date, 'audit.retention_current', 'audit_log', $2, 'Current retention smoke log.', $3::jsonb)
        RETURNING id::text, target_id
      `,
      [`${testRunId}-old`, `${testRunId}-current`, JSON.stringify({ testRunId })],
    );
    const oldId = result.rows.find((row: { id: string; target_id: string }) => row.target_id.endsWith('-old'))?.id || '';
    const currentId = result.rows.find((row: { id: string; target_id: string }) => row.target_id.endsWith('-current'))?.id || '';
    return { oldId, currentId };
  } finally {
    await postgres.disconnect();
  }
}

async function logExists(id: string): Promise<boolean> {
  const postgres = createPostgresClient('audit-retention-exists');

  try {
    const result = await postgres.pool.query('SELECT 1 FROM audit_log WHERE id = $1::uuid', [id]);
    return (result.rowCount ?? 0) > 0;
  } finally {
    await postgres.disconnect();
  }
}

async function cleanup(): Promise<void> {
  const postgres = createPostgresClient('audit-retention-cleanup');

  try {
    await postgres.pool.query("DELETE FROM audit_log WHERE metadata->>'testRunId' = $1", [testRunId]).catch(() => undefined);
  } finally {
    await postgres.disconnect();
  }
}

async function main() {
  const retentionSnapshot = await snapshotRetention();

  try {
    await setRetention('1');
    const { oldId, currentId } = await insertLogs();
    assert.ok(oldId && currentId, 'Expected retention smoke logs to be inserted.');

    const deleted = await pruneAuditLogs();
    assert.ok(deleted >= 1, 'Expected at least one old audit log to be pruned.');
    assert.equal(await logExists(oldId), false, 'Old audit log should be pruned.');
    assert.equal(await logExists(currentId), true, 'Current audit log should be retained.');

    console.log('Audit retention check passed.');
    console.log(JSON.stringify({ deleted }, null, 2));
  } finally {
    await cleanup();
    await setRetention(retentionSnapshot);
  }
}

main().catch(async (error) => {
  await cleanup().catch(() => undefined);
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
