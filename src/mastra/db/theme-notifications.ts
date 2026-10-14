import { createPostgresClient } from './postgres';
import { ensureUsersTable } from './users';

let ensured: Promise<void> | undefined;
async function ensureTable() {
  ensured ||= (async () => {
    await ensureUsersTable();
    const db = createPostgresClient('theme-notification-schema');
    try {
      await db.pool.query(`CREATE TABLE IF NOT EXISTS theme_notification_reads (
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        notification_id TEXT NOT NULL,
        read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY(user_id, notification_id)
      )`);
    } finally { await db.disconnect(); }
  })();
  return ensured;
}

export async function readThemeNotificationIds(userId: string): Promise<Set<string>> {
  await ensureTable();
  const db = createPostgresClient('theme-notification-reads');
  try {
    const result = await db.pool.query<{ notification_id: string }>('SELECT notification_id FROM theme_notification_reads WHERE user_id = $1', [userId]);
    return new Set(result.rows.map((row: { notification_id: string }) => row.notification_id));
  } finally { await db.disconnect(); }
}

export async function markThemeNotificationsRead(userId: string, ids: string[]): Promise<void> {
  if (!ids.length) return;
  await ensureTable();
  const db = createPostgresClient('theme-notification-mark-read');
  try {
    await db.pool.query(`INSERT INTO theme_notification_reads(user_id, notification_id)
      SELECT $1::uuid, id FROM unnest($2::text[]) AS id
      ON CONFLICT(user_id, notification_id) DO NOTHING`, [userId, ids]);
  } finally { await db.disconnect(); }
}
