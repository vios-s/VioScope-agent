import { AuthError } from '../auth/session';
import { createPostgresClient, withDatabaseTransaction } from './postgres';
import { ensureUsersTable, type AuthUser } from './users';

export const feedbackStatuses = ['pending', 'in_progress', 'solved', 'closed'] as const;
export type FeedbackStatus = (typeof feedbackStatuses)[number];

export type FeedbackAttachment = {
  name: string;
  mimeType: string;
  size: number;
};

export type FeedbackQuery = {
  id: string;
  title: string;
  description: string;
  status: FeedbackStatus;
  adminNote: string;
  submitterUsername: string;
  submitterDisplayName: string;
  attachment: FeedbackAttachment | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  resolvedByUsername: string | null;
  history: FeedbackHistoryEntry[];
  deletedAt: string | null;
};

export type FeedbackHistoryEntry = { by: string; at: string; action: 'edited' | 'deleted' | 'reply'; title?: string; description?: string; status?: string; adminNote?: string };

type FeedbackRow = {
  id: string;
  title: string;
  description: string;
  status: FeedbackStatus;
  admin_note: string;
  attachment_name: string | null;
  attachment_mime_type: string | null;
  attachment_size: number | string | null;
  submitter_username: string;
  submitter_display_name: string;
  created_at: Date | string;
  updated_at: Date | string;
  resolved_at: Date | string | null;
  resolved_by_username: string | null;
  history: FeedbackHistoryEntry[];
  deleted_at: Date | string | null;
};

type FeedbackAttachmentRow = {
  id: string;
  user_id: string;
  attachment_path: string | null;
  attachment_name: string | null;
  attachment_mime_type: string | null;
  attachment_size: number | string | null;
};

function toFeedbackQuery(row: FeedbackRow): FeedbackQuery {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    adminNote: row.admin_note,
    submitterUsername: row.submitter_username,
    submitterDisplayName: row.submitter_display_name,
    attachment: row.attachment_name
      ? {
          name: row.attachment_name,
          mimeType: row.attachment_mime_type || 'application/octet-stream',
          size: Number(row.attachment_size || 0),
        }
      : null,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    resolvedAt: row.resolved_at ? new Date(row.resolved_at).toISOString() : null,
    resolvedByUsername: row.resolved_by_username,
    history: row.history,
    deletedAt: row.deleted_at ? new Date(row.deleted_at).toISOString() : null,
  };
}

let ensureFeedbackTablePromise: Promise<void> | null = null;

// Runs once per process: the ALTER TABLE statements take an exclusive table lock even when nothing changes.
export async function ensureFeedbackTable(): Promise<void> {
  ensureFeedbackTablePromise ||= ensureFeedbackTableOnce().catch((error) => {
    ensureFeedbackTablePromise = null;
    throw error;
  });
  return ensureFeedbackTablePromise;
}

async function ensureFeedbackTableOnce(): Promise<void> {
  await ensureUsersTable();
  const postgres = createPostgresClient('vioscope-feedback');

  try {
    await postgres.pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
    await postgres.pool.query(`
      CREATE TABLE IF NOT EXISTS feedback_queries (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 180),
        description TEXT NOT NULL CHECK (char_length(description) BETWEEN 1 AND 10000),
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'solved', 'closed')),
        admin_note TEXT NOT NULL DEFAULT '',
        attachment_name TEXT,
        attachment_path TEXT,
        attachment_mime_type TEXT,
        attachment_size BIGINT,
        resolved_at TIMESTAMPTZ,
        resolved_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await postgres.pool.query("ALTER TABLE feedback_queries ADD COLUMN IF NOT EXISTS history JSONB NOT NULL DEFAULT '[]'::jsonb");
    await postgres.pool.query('ALTER TABLE feedback_queries ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ');
    await postgres.pool.query('CREATE INDEX IF NOT EXISTS feedback_queries_user_idx ON feedback_queries (user_id, created_at DESC)');
    await postgres.pool.query('CREATE INDEX IF NOT EXISTS feedback_queries_status_idx ON feedback_queries (status, updated_at DESC)');
  } finally {
    await postgres.disconnect();
  }
}

const feedbackSelect = `
  SELECT
    feedback.id::text,
    feedback.history,
    feedback.deleted_at,
    feedback.title,
    feedback.description,
    feedback.status,
    feedback.admin_note,
    feedback.attachment_name,
    feedback.attachment_mime_type,
    feedback.attachment_size,
    submitter.username AS submitter_username,
    submitter.display_name AS submitter_display_name,
    feedback.created_at,
    feedback.updated_at,
    feedback.resolved_at,
    resolver.username AS resolved_by_username
  FROM feedback_queries feedback
  JOIN users submitter ON submitter.id = feedback.user_id
  LEFT JOIN users resolver ON resolver.id = feedback.resolved_by_user_id
`;

export async function createFeedbackQuery(input: {
  id: string;
  user: AuthUser;
  title: string;
  description: string;
  attachment?: FeedbackAttachment & { path: string };
}): Promise<FeedbackQuery> {
  await ensureFeedbackTable();
  const postgres = createPostgresClient('vioscope-feedback-create');

  try {
    await postgres.pool.query(
      `
        INSERT INTO feedback_queries (
          id, user_id, title, description, attachment_name, attachment_path, attachment_mime_type, attachment_size
        )
        VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8)
      `,
      [
        input.id,
        input.user.id,
        input.title.trim(),
        input.description.trim(),
        input.attachment?.name || null,
        input.attachment?.path || null,
        input.attachment?.mimeType || null,
        input.attachment?.size || null,
      ],
    );
    const result = await postgres.pool.query<FeedbackRow>(`${feedbackSelect} WHERE feedback.id = $1::uuid`, [input.id]);
    const row = result.rows[0];
    if (!row) throw new Error('Feedback submission could not be saved.');
    return toFeedbackQuery(row);
  } finally {
    await postgres.disconnect();
  }
}

export async function listFeedbackQueries(user: AuthUser, includeRemoved = false): Promise<FeedbackQuery[]> {
  await ensureFeedbackTable();
  const postgres = createPostgresClient('vioscope-feedback-list');
  const admin = user.role === 'administrator';

  try {
    const result = await postgres.pool.query<FeedbackRow>(
      `${feedbackSelect}
       WHERE ${includeRemoved ? 'feedback.deleted_at IS NOT NULL' : 'feedback.deleted_at IS NULL'} ${admin ? '' : 'AND feedback.user_id = $1::uuid'}
       ORDER BY feedback.updated_at DESC`,
      admin ? [] : [user.id],
    );
    return result.rows.map(toFeedbackQuery);
  } finally {
    await postgres.disconnect();
  }
}

export async function getFeedbackAttachmentForUser(
  id: string,
  user: AuthUser,
): Promise<{ name: string; mimeType: string; size: number; path: string }> {
  await ensureFeedbackTable();
  const postgres = createPostgresClient('vioscope-feedback-attachment');
  const admin = user.role === 'administrator';

  try {
    const result = await postgres.pool.query<FeedbackAttachmentRow>(
      `
        SELECT id::text, user_id::text, attachment_path, attachment_name, attachment_mime_type, attachment_size
        FROM feedback_queries
        WHERE id = $1::uuid AND deleted_at IS NULL ${admin ? '' : 'AND user_id = $2::uuid'}
      `,
      admin ? [id] : [id, user.id],
    );
    const row = result.rows[0];
    if (!row || !row.attachment_path || !row.attachment_name) {
      throw new Error('Feedback attachment was not found.');
    }
    return {
      name: row.attachment_name,
      mimeType: row.attachment_mime_type || 'application/octet-stream',
      size: Number(row.attachment_size || 0),
      path: row.attachment_path,
    };
  } finally {
    await postgres.disconnect();
  }
}

// `changed` compares with the stored row (locked for the update), so saving the same reply and status
// twice reports no change and the requester is not notified twice.
export async function updateFeedbackQuery(
  id: string,
  input: { status: FeedbackStatus; adminNote: string; actor: AuthUser },
): Promise<{ query: FeedbackQuery; changed: { status: boolean; reply: boolean } }> {
  await ensureFeedbackTable();
  const postgres = createPostgresClient('vioscope-feedback-update');

  try {
    const changed = await postgres.pool.query<{ previous_status: FeedbackStatus; previous_note: string }>(
      `
        WITH previous AS (
          SELECT id, status, admin_note FROM feedback_queries WHERE id = $1::uuid AND deleted_at IS NULL FOR UPDATE
        )
        UPDATE feedback_queries feedback
        SET
          history = CASE WHEN previous.status IS DISTINCT FROM $2 OR previous.admin_note IS DISTINCT FROM $3
            THEN history || jsonb_build_array(jsonb_build_object('by',$5::text,'at',now(),'action','reply','status',previous.status,'adminNote',previous.admin_note))
            ELSE history END,
          status = $2,
          admin_note = $3,
          resolved_at = CASE WHEN $2 IN ('solved', 'closed') THEN now() ELSE NULL END,
          resolved_by_user_id = CASE WHEN $2 IN ('solved', 'closed') THEN $4::uuid ELSE NULL END,
          updated_at = now()
        FROM previous
        WHERE feedback.id = previous.id
        RETURNING previous.status AS previous_status, previous.admin_note AS previous_note
      `,
      [id, input.status, input.adminNote.trim(), input.actor.id, input.actor.username],
    );
    const previous = changed.rows[0];
    if (!previous) throw new Error('Feedback request was not found.');
    const result = await postgres.pool.query<FeedbackRow>(`${feedbackSelect} WHERE feedback.id = $1::uuid`, [id]);
    const row = result.rows[0];
    if (!row) throw new Error('Feedback request was not found.');
    const query = toFeedbackQuery(row);
    return { query, changed: { status: previous.previous_status !== query.status, reply: previous.previous_note !== query.adminNote } };
  } finally {
    await postgres.disconnect();
  }
}

export async function changeFeedbackContent(id: string, actor: AuthUser, expected: { title: string; description: string }, next: { title: string; description: string } | null): Promise<FeedbackQuery | null> {
  await ensureFeedbackTable();
  if (next && (!next.title.trim() || next.title.trim().length > 180 || !next.description.trim() || next.description.trim().length > 10000)) throw new Error('Enter a title and description within the allowed limits.');
  return withDatabaseTransaction(async () => {
    const db = createPostgresClient();
    const result = await db.pool.query<{ user_id: string; title: string; description: string }>(
      'SELECT user_id::text,title,description FROM feedback_queries WHERE id=$1 AND deleted_at IS NULL FOR UPDATE', [id]);
    const row = result.rows[0];
    if (!row) throw new AuthError('Feedback request was not found.', 404, 'not_found');
    if (row.user_id !== actor.id && actor.role !== 'administrator') throw new AuthError('Only the requester or an administrator can change this request.', 403, 'forbidden');
    if (row.title !== expected.title || row.description !== expected.description) throw new AuthError('This request changed. Reload and try again.', 409, 'conflict');
    await db.pool.query(`UPDATE feedback_queries SET title=COALESCE($2,title),description=COALESCE($3,description),
      deleted_at=CASE WHEN $2::text IS NULL THEN now() ELSE NULL END,updated_at=now(),
      history=history || jsonb_build_array(jsonb_build_object('by',$4::text,'at',now(),'action',CASE WHEN $2::text IS NULL THEN 'deleted' ELSE 'edited' END,'title',title,'description',description))
      WHERE id=$1`, [id, next?.title.trim() ?? null, next?.description.trim() ?? null, actor.username]);
    if (!next) return null;
    const saved = await db.pool.query<FeedbackRow>(`${feedbackSelect} WHERE feedback.id=$1`, [id]);
    return toFeedbackQuery(saved.rows[0]);
  });
}
