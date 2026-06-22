import { getAppSettingValue } from './app-settings';
import { createPostgresClient } from './postgres';
import { ensureUsersTable, type AuthUser } from './users';

export type AuditLogRecord = {
  id: string;
  eventTime: string;
  eventDay: string;
  actorUserId: string | null;
  actorUsername: string | null;
  actorRole: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  summary: string;
  metadata: Record<string, unknown>;
};

export type AuditLogDay = {
  day: string;
  fileName: string;
  count: number;
};

type AuditLogRow = {
  id: string;
  event_time: Date | string;
  event_day: string;
  actor_user_id: string | null;
  actor_username: string | null;
  actor_role: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  summary: string;
  metadata: Record<string, unknown> | string | null;
};

type AuditLogDayRow = {
  event_day: string;
  entry_count: number | string;
};

let ensureAuditLogTablePromise: Promise<void> | null = null;
let lastPruneDay: string | null = null;

function metadataObject(value: Record<string, unknown> | string | null): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return value;
}

function toRecord(row: AuditLogRow): AuditLogRecord {
  return {
    id: row.id,
    eventTime: new Date(row.event_time).toISOString(),
    eventDay: row.event_day,
    actorUserId: row.actor_user_id,
    actorUsername: row.actor_username,
    actorRole: row.actor_role,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    summary: row.summary,
    metadata: metadataObject(row.metadata),
  };
}

async function ensureAuditLogTableOnce(): Promise<void> {
  await ensureUsersTable();
  const postgres = createPostgresClient('vioscope-audit-log');

  try {
    await postgres.pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
    await postgres.pool.query(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        event_time TIMESTAMPTZ NOT NULL DEFAULT now(),
        event_day DATE NOT NULL DEFAULT CURRENT_DATE,
        actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        actor_username TEXT,
        actor_role TEXT,
        action TEXT NOT NULL,
        target_type TEXT NOT NULL DEFAULT '',
        target_id TEXT,
        summary TEXT NOT NULL DEFAULT '',
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb
      )
    `);
    await postgres.pool.query('CREATE INDEX IF NOT EXISTS audit_log_event_time_idx ON audit_log (event_time DESC)');
    await postgres.pool.query('CREATE INDEX IF NOT EXISTS audit_log_event_day_idx ON audit_log (event_day, event_time DESC)');
    await postgres.pool.query('CREATE INDEX IF NOT EXISTS audit_log_actor_idx ON audit_log (actor_user_id, event_time DESC)');
    await postgres.pool.query('CREATE INDEX IF NOT EXISTS audit_log_action_idx ON audit_log (action, event_time DESC)');
  } finally {
    await postgres.disconnect();
  }
}

export async function ensureAuditLogTable(): Promise<void> {
  ensureAuditLogTablePromise ||= ensureAuditLogTableOnce().catch((error) => {
    ensureAuditLogTablePromise = null;
    throw error;
  });
  return ensureAuditLogTablePromise;
}

export async function recordAuditLog(input: {
  actor?: Pick<AuthUser, 'id' | 'username' | 'role'> | null;
  action: string;
  targetType?: string;
  targetId?: string | null;
  summary?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await ensureAuditLogTable();
  const postgres = createPostgresClient('vioscope-audit-log');
  const metadata = process.env.VIOSCOPE_AUDIT_TEST_RUN_ID
    ? { ...(input.metadata || {}), testRunId: process.env.VIOSCOPE_AUDIT_TEST_RUN_ID }
    : input.metadata || {};

  try {
    await postgres.pool.query(
      `
        INSERT INTO audit_log (
          actor_user_id,
          actor_username,
          actor_role,
          action,
          target_type,
          target_id,
          summary,
          metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
      `,
      [
        input.actor?.id || null,
        input.actor?.username || null,
        input.actor?.role || null,
        input.action,
        input.targetType || 'system',
        input.targetId || null,
        input.summary || '',
        JSON.stringify(metadata),
      ],
    );
    await pruneAuditLogsOncePerDay().catch(() => undefined);
  } finally {
    await postgres.disconnect();
  }
}

async function auditLogRetentionDays(): Promise<number> {
  const configured = (await getAppSettingValue('AUDIT_LOG_RETENTION_DAYS')) ?? process.env.AUDIT_LOG_RETENTION_DAYS ?? '90';
  const days = Number.parseInt(configured, 10);
  return Number.isInteger(days) && days >= 1 && days <= 3650 ? days : 90;
}

export async function pruneAuditLogs(input: { retentionDays?: number } = {}): Promise<number> {
  await ensureAuditLogTable();
  const retentionDays = input.retentionDays ?? (await auditLogRetentionDays());
  const postgres = createPostgresClient('vioscope-audit-prune');

  try {
    const result = await postgres.pool.query<{ id: string }>(
      `
        DELETE FROM audit_log
        WHERE event_time < now() - ($1::int * interval '1 day')
        RETURNING id::text
      `,
      [retentionDays],
    );
    return result.rowCount ?? 0;
  } finally {
    await postgres.disconnect();
  }
}

async function pruneAuditLogsOncePerDay(): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  if (lastPruneDay === today) {
    return;
  }

  await pruneAuditLogs();
  lastPruneDay = today;
}

export function auditLogFileName(day: string): string {
  return `audit-${day}.jsonl`;
}

export async function listAuditLogs(input: { day: string; limit?: number }): Promise<AuditLogRecord[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.day)) {
    throw new Error('day must use YYYY-MM-DD.');
  }

  await ensureAuditLogTable();
  const postgres = createPostgresClient('vioscope-audit-log');

  try {
    const result = await postgres.pool.query<AuditLogRow>(
      `
        SELECT
          id::text,
          event_time,
          event_day::text,
          actor_user_id::text,
          actor_username,
          actor_role,
          action,
          target_type,
          target_id,
          summary,
          metadata
        FROM audit_log
        WHERE event_day = $1::date
        ORDER BY event_time DESC
        LIMIT $2
      `,
      [input.day, Math.max(1, Math.min(input.limit || 200, 1000))],
    );
    return result.rows.map(toRecord);
  } finally {
    await postgres.disconnect();
  }
}

export async function listAuditLogDays(limit = 365): Promise<AuditLogDay[]> {
  await ensureAuditLogTable();
  const postgres = createPostgresClient('vioscope-audit-log');

  try {
    const result = await postgres.pool.query<AuditLogDayRow>(
      `
        SELECT event_day::text, count(*)::int AS entry_count
        FROM audit_log
        GROUP BY event_day
        ORDER BY event_day DESC
        LIMIT $1
      `,
      [Math.max(1, Math.min(limit, 1000))],
    );
    return result.rows.map((row: AuditLogDayRow) => ({
      day: row.event_day,
      fileName: auditLogFileName(row.event_day),
      count: Number(row.entry_count),
    }));
  } finally {
    await postgres.disconnect();
  }
}
