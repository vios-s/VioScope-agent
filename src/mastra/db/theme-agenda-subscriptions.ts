import { createPostgresClient } from './postgres';
import { ensureUsersTable } from './users';

export type ThemeAgendaSubscription = { username: string; themeId: string };

let ensured: Promise<void> | undefined;
async function ensureTable() {
  ensured ||= (async () => {
    await ensureUsersTable();
    const db = createPostgresClient('theme-agenda-subscription-schema');
    try {
      await db.pool.query(`CREATE TABLE IF NOT EXISTS theme_agenda_subscriptions (
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        theme_id TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY(user_id, theme_id)
      )`);
    } finally { await db.disconnect(); }
  })().catch((error) => { ensured = undefined; throw error; });
  return ensured;
}

export async function listThemeAgendaSubscriptions(userId?: string): Promise<ThemeAgendaSubscription[]> {
  await ensureTable();
  const db = createPostgresClient('theme-agenda-subscriptions');
  try {
    const result = await db.pool.query<ThemeAgendaSubscription>(`
      SELECT u.username, s.theme_id AS "themeId"
      FROM theme_agenda_subscriptions s JOIN users u ON u.id = s.user_id
      WHERE u.provisioning_status = 'active' AND u.role <> 'service'
        AND ($1::uuid IS NULL OR s.user_id = $1::uuid)
      ORDER BY s.theme_id, u.username`, [userId || null]);
    return result.rows;
  } finally { await db.disconnect(); }
}

export async function setThemeAgendaSubscription(userId: string, themeId: string, subscribed: boolean): Promise<void> {
  await ensureTable();
  const db = createPostgresClient('theme-agenda-subscription-save');
  try {
    if (subscribed) {
      await db.pool.query(`INSERT INTO theme_agenda_subscriptions(user_id, theme_id)
        SELECT id, $2 FROM users WHERE id = $1 AND provisioning_status = 'active' AND role <> 'service'
        ON CONFLICT(user_id, theme_id) DO NOTHING`, [userId, themeId]);
    } else {
      await db.pool.query('DELETE FROM theme_agenda_subscriptions WHERE user_id = $1 AND theme_id = $2', [userId, themeId]);
    }
  } finally { await db.disconnect(); }
}
