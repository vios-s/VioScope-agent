import { createPostgresClient } from './postgres';

export type LogKbGapParams = {
  question: string;
  source?: string;
  sessionId?: string;
};

export type KbGapRecord = {
  id: string;
  question: string;
  source: string;
  sessionId: string | null;
  createdAt: string;
};

type KbGapRow = {
  id: string;
  question: string;
  source: string;
  session_id: string | null;
  created_at: Date | string;
};

function toRecord(row: KbGapRow): KbGapRecord {
  return {
    id: row.id,
    question: row.question,
    source: row.source,
    sessionId: row.session_id,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export async function logKbGap({ question, source = 'wiki_qa', sessionId }: LogKbGapParams): Promise<KbGapRecord> {
  const trimmedQuestion = question.trim();
  const trimmedSource = source.trim() || 'wiki_qa';
  const trimmedSessionId = sessionId?.trim() || null;

  if (!trimmedQuestion) {
    throw new Error('Cannot log an empty knowledge-base gap question.');
  }

  const postgres = createPostgresClient('vioscope-kb-gaps');

  try {
    const result = await postgres.pool.query<KbGapRow>(
      `
        INSERT INTO kb_gaps (question, source, session_id)
        VALUES ($1, $2, $3)
        RETURNING id::text, question, source, session_id, created_at
      `,
      [trimmedQuestion, trimmedSource, trimmedSessionId],
    );

    const row = result.rows[0];
    if (!row) {
      throw new Error('Knowledge-base gap insert did not return a row.');
    }

    return toRecord(row);
  } finally {
    await postgres.disconnect();
  }
}

export async function countKbGaps(): Promise<number> {
  const postgres = createPostgresClient('vioscope-kb-gaps');

  try {
    const result = await postgres.pool.query<{ count: number }>('SELECT count(*)::int AS count FROM kb_gaps');
    return result.rows[0]?.count ?? 0;
  } finally {
    await postgres.disconnect();
  }
}

export async function getLatestKbGap(): Promise<KbGapRecord | null> {
  const postgres = createPostgresClient('vioscope-kb-gaps');

  try {
    const result = await postgres.pool.query<KbGapRow>(
      `
        SELECT id::text, question, source, session_id, created_at
        FROM kb_gaps
        ORDER BY id DESC
        LIMIT 1
      `,
    );

    return result.rows[0] ? toRecord(result.rows[0]) : null;
  } finally {
    await postgres.disconnect();
  }
}

export async function deleteKbGapsBySessionPrefix(sessionPrefix: string): Promise<number> {
  const trimmedSessionPrefix = sessionPrefix.trim();

  if (!trimmedSessionPrefix) {
    throw new Error('Cannot delete knowledge-base gaps with an empty session prefix.');
  }

  const postgres = createPostgresClient('vioscope-kb-gaps');

  try {
    const result = await postgres.pool.query<{ id: string }>(
      'DELETE FROM kb_gaps WHERE session_id LIKE $1 RETURNING id::text',
      [`${trimmedSessionPrefix}%`],
    );
    return result.rowCount ?? 0;
  } finally {
    await postgres.disconnect();
  }
}
