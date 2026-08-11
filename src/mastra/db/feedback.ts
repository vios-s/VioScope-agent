import { createPostgresClient } from './postgres';
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
};

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
  };
}

export async function ensureFeedbackTable(): Promise<void> {
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
    await postgres.pool.query('CREATE INDEX IF NOT EXISTS feedback_queries_user_idx ON feedback_queries (user_id, created_at DESC)');
    await postgres.pool.query('CREATE INDEX IF NOT EXISTS feedback_queries_status_idx ON feedback_queries (status, updated_at DESC)');
  } finally {
    await postgres.disconnect();
  }
}

const feedbackSelect = `
  SELECT
    feedback.id::text,
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

export async function listFeedbackQueries(user: AuthUser): Promise<FeedbackQuery[]> {
  await ensureFeedbackTable();
  const postgres = createPostgresClient('vioscope-feedback-list');
  const admin = user.role === 'administrator';

  try {
    const result = await postgres.pool.query<FeedbackRow>(
      `${feedbackSelect}
       ${admin ? '' : 'WHERE feedback.user_id = $1::uuid'}
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
        WHERE id = $1::uuid ${admin ? '' : 'AND user_id = $2::uuid'}
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

export async function updateFeedbackQuery(
  id: string,
  input: { status: FeedbackStatus; adminNote: string; actor: AuthUser },
): Promise<FeedbackQuery> {
  await ensureFeedbackTable();
  const postgres = createPostgresClient('vioscope-feedback-update');

  try {
    const changed = await postgres.pool.query(
      `
        UPDATE feedback_queries
        SET
          status = $2,
          admin_note = $3,
          resolved_at = CASE WHEN $2 IN ('solved', 'closed') THEN now() ELSE NULL END,
          resolved_by_user_id = CASE WHEN $2 IN ('solved', 'closed') THEN $4::uuid ELSE NULL END,
          updated_at = now()
        WHERE id = $1::uuid
      `,
      [id, input.status, input.adminNote.trim(), input.actor.id],
    );
    if (!changed.rowCount) throw new Error('Feedback request was not found.');
    const result = await postgres.pool.query<FeedbackRow>(`${feedbackSelect} WHERE feedback.id = $1::uuid`, [id]);
    const row = result.rows[0];
    if (!row) throw new Error('Feedback request was not found.');
    return toFeedbackQuery(row);
  } finally {
    await postgres.disconnect();
  }
}
