import { createPostgresClient } from './postgres';

export type ReviewSignoffStatus = 'pending' | 'accepted' | 'needs_revision' | 'rejected';
export type ReviewVerdict = 'CLEARED' | 'CONDITIONAL' | 'SLIDE';

export type ReviewCheckInput = {
  skillName: string;
  skillLabel: string;
  verdict: ReviewVerdict;
  reportMarkdown: string;
  resultJson: unknown;
  signoffStatus?: ReviewSignoffStatus;
  reviewerNote?: string;
  signedOffBy?: string;
};

export type SaveReviewRunInput = {
  id?: string;
  projectName?: string;
  draftName: string;
  targetVenue?: string;
  deadline?: string;
  initiator?: string;
  piOrSeniorReviewer?: string;
  cooperators?: string[];
  reviewer?: string;
  metadata?: Record<string, unknown>;
  checks: ReviewCheckInput[];
};

export type ReviewRunSummary = {
  id: string;
  projectName: string | null;
  draftName: string;
  targetVenue: string | null;
  deadline: string | null;
  initiator: string | null;
  piOrSeniorReviewer: string | null;
  cooperators: string[];
  reviewer: string | null;
  createdAt: string;
  updatedAt: string;
  checkCount: number;
  verdicts: ReviewVerdict[];
  signoffStatuses: ReviewSignoffStatus[];
};

export type ReviewCheckRecord = {
  id: string;
  skillName: string;
  skillLabel: string;
  verdict: ReviewVerdict;
  reportMarkdown: string;
  resultJson: unknown;
  signoffStatus: ReviewSignoffStatus;
  reviewerNote: string;
  signedOffBy: string | null;
  signedOffAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ReviewRunRecord = Omit<ReviewRunSummary, 'checkCount' | 'verdicts' | 'signoffStatuses'> & {
  metadata: Record<string, unknown>;
  checks: ReviewCheckRecord[];
};

type ReviewRunRow = {
  id: string;
  project_name: string | null;
  draft_name: string;
  target_venue: string | null;
  deadline: string | null;
  initiator: string | null;
  pi_or_senior_reviewer: string | null;
  cooperators: string[] | null;
  reviewer: string | null;
  metadata: Record<string, unknown> | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type ReviewRunSummaryRow = ReviewRunRow & {
  check_count: number;
  verdicts: ReviewVerdict[] | null;
  signoff_statuses: ReviewSignoffStatus[] | null;
};

type ReviewCheckRow = {
  id: string;
  skill_name: string;
  skill_label: string;
  verdict: ReviewVerdict;
  report_markdown: string;
  result_json: unknown;
  signoff_status: ReviewSignoffStatus;
  reviewer_note: string;
  signed_off_by: string | null;
  signed_off_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

function nullableText(value?: string): string | null {
  const trimmed = value?.trim();
  return trimmed || null;
}

function cleanTextArray(values?: string[]): string[] {
  return [...new Set((values || []).map((value) => value.trim()).filter(Boolean))];
}

function dateString(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return new Date(value).toISOString();
}

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

function toRunBase(row: ReviewRunRow) {
  return {
    id: row.id,
    projectName: row.project_name,
    draftName: row.draft_name,
    targetVenue: row.target_venue,
    deadline: row.deadline,
    initiator: row.initiator,
    piOrSeniorReviewer: row.pi_or_senior_reviewer,
    cooperators: row.cooperators || [],
    reviewer: row.reviewer,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function toRunSummary(row: ReviewRunSummaryRow): ReviewRunSummary {
  return {
    ...toRunBase(row),
    checkCount: row.check_count,
    verdicts: row.verdicts || [],
    signoffStatuses: row.signoff_statuses || [],
  };
}

function toCheckRecord(row: ReviewCheckRow): ReviewCheckRecord {
  return {
    id: row.id,
    skillName: row.skill_name,
    skillLabel: row.skill_label,
    verdict: row.verdict,
    reportMarkdown: row.report_markdown,
    resultJson: row.result_json,
    signoffStatus: row.signoff_status,
    reviewerNote: row.reviewer_note,
    signedOffBy: row.signed_off_by,
    signedOffAt: dateString(row.signed_off_at),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export async function ensureReviewRunTables(): Promise<void> {
  const postgres = createPostgresClient('vioscope-review-runs');

  try {
    await postgres.pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
    await postgres.pool.query(`
      CREATE TABLE IF NOT EXISTS review_runs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_name TEXT,
        draft_name TEXT NOT NULL,
        target_venue TEXT,
        deadline TEXT,
        initiator TEXT,
        pi_or_senior_reviewer TEXT,
        cooperators TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
        reviewer TEXT,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await postgres.pool.query(`
      CREATE TABLE IF NOT EXISTS review_check_results (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        run_id UUID NOT NULL REFERENCES review_runs(id) ON DELETE CASCADE,
        skill_name TEXT NOT NULL,
        skill_label TEXT NOT NULL,
        verdict TEXT NOT NULL CHECK (verdict IN ('CLEARED', 'CONDITIONAL', 'SLIDE')),
        report_markdown TEXT NOT NULL,
        result_json JSONB NOT NULL,
        signoff_status TEXT NOT NULL DEFAULT 'pending' CHECK (
          signoff_status IN ('pending', 'accepted', 'needs_revision', 'rejected')
        ),
        reviewer_note TEXT NOT NULL DEFAULT '',
        signed_off_by TEXT,
        signed_off_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (run_id, skill_name)
      )
    `);
    await postgres.pool.query('CREATE INDEX IF NOT EXISTS review_runs_created_at_idx ON review_runs (created_at DESC)');
    await postgres.pool.query('CREATE INDEX IF NOT EXISTS review_runs_project_name_idx ON review_runs (project_name)');
    await postgres.pool.query('CREATE INDEX IF NOT EXISTS review_check_results_run_id_idx ON review_check_results (run_id)');
    await postgres.pool.query(
      'CREATE INDEX IF NOT EXISTS review_check_results_signoff_status_idx ON review_check_results (signoff_status)',
    );
  } finally {
    await postgres.disconnect();
  }
}

export async function saveReviewRun(input: SaveReviewRunInput): Promise<ReviewRunRecord> {
  if (!input.draftName.trim()) {
    throw new Error('draftName is required.');
  }

  if (!input.checks.length) {
    throw new Error('At least one review check result is required.');
  }

  await ensureReviewRunTables();
  const postgres = createPostgresClient('vioscope-review-runs');
  let client: Awaited<ReturnType<typeof postgres.pool.connect>> | undefined;
  let savedRunId: string | undefined;

  try {
    client = await postgres.pool.connect();
    await client.query('BEGIN');

    const runResult = await client.query<ReviewRunRow>(
      `
        INSERT INTO review_runs (
          id,
          project_name,
          draft_name,
          target_venue,
          deadline,
          initiator,
          pi_or_senior_reviewer,
          cooperators,
          reviewer,
          metadata
        )
        VALUES (
          COALESCE($1::uuid, gen_random_uuid()),
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          $9,
          $10::jsonb
        )
        ON CONFLICT (id) DO UPDATE
        SET
          project_name = EXCLUDED.project_name,
          draft_name = EXCLUDED.draft_name,
          target_venue = EXCLUDED.target_venue,
          deadline = EXCLUDED.deadline,
          initiator = EXCLUDED.initiator,
          pi_or_senior_reviewer = EXCLUDED.pi_or_senior_reviewer,
          cooperators = EXCLUDED.cooperators,
          reviewer = EXCLUDED.reviewer,
          metadata = review_runs.metadata || EXCLUDED.metadata,
          updated_at = now()
        RETURNING id::text, project_name, draft_name, target_venue, deadline, initiator,
          pi_or_senior_reviewer, cooperators, reviewer, metadata, created_at, updated_at
      `,
      [
        input.id || null,
        nullableText(input.projectName),
        input.draftName.trim(),
        nullableText(input.targetVenue),
        nullableText(input.deadline),
        nullableText(input.initiator),
        nullableText(input.piOrSeniorReviewer),
        cleanTextArray(input.cooperators),
        nullableText(input.reviewer),
        JSON.stringify(input.metadata || {}),
      ],
    );

    const run = runResult.rows[0];
    if (!run) {
      throw new Error('Review run save did not return a row.');
    }

    for (const check of input.checks) {
      const note = check.reviewerNote?.trim() || '';
      const signedOffBy = nullableText(check.signedOffBy);
      await client.query(
        `
          INSERT INTO review_check_results (
            run_id,
            skill_name,
            skill_label,
            verdict,
            report_markdown,
            result_json,
            signoff_status,
            reviewer_note,
            signed_off_by,
            signed_off_at
          )
          VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, CASE WHEN $7 = 'pending' THEN NULL ELSE now() END)
          ON CONFLICT (run_id, skill_name) DO UPDATE
          SET
            skill_label = EXCLUDED.skill_label,
            verdict = EXCLUDED.verdict,
            report_markdown = EXCLUDED.report_markdown,
            result_json = EXCLUDED.result_json,
            signoff_status = EXCLUDED.signoff_status,
            reviewer_note = EXCLUDED.reviewer_note,
            signed_off_by = EXCLUDED.signed_off_by,
            signed_off_at = CASE
              WHEN EXCLUDED.signoff_status = 'pending' THEN NULL
              ELSE COALESCE(review_check_results.signed_off_at, now())
            END,
            updated_at = now()
        `,
        [
          run.id,
          check.skillName,
          check.skillLabel,
          check.verdict,
          check.reportMarkdown,
          JSON.stringify(check.resultJson),
          check.signoffStatus || 'pending',
          note,
          signedOffBy,
        ],
      );
    }

    savedRunId = run.id;
    await client.query('COMMIT');
  } catch (error) {
    await client?.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client?.release();
    await postgres.disconnect();
  }

  if (!savedRunId) {
    throw new Error('Review run save did not return an id.');
  }

  return getReviewRun(savedRunId);
}

export async function listReviewRuns(limit = 20): Promise<ReviewRunSummary[]> {
  await ensureReviewRunTables();
  const postgres = createPostgresClient('vioscope-review-runs');

  try {
    const result = await postgres.pool.query<ReviewRunSummaryRow>(
      `
        SELECT
          r.id::text,
          r.project_name,
          r.draft_name,
          r.target_venue,
          r.deadline,
          r.initiator,
          r.pi_or_senior_reviewer,
          r.cooperators,
          r.reviewer,
          r.metadata,
          r.created_at,
          r.updated_at,
          count(c.id)::int AS check_count,
          COALESCE(array_agg(c.verdict ORDER BY c.skill_name) FILTER (WHERE c.id IS NOT NULL), ARRAY[]::text[]) AS verdicts,
          COALESCE(
            array_agg(c.signoff_status ORDER BY c.skill_name) FILTER (WHERE c.id IS NOT NULL),
            ARRAY[]::text[]
          ) AS signoff_statuses
        FROM review_runs r
        LEFT JOIN review_check_results c ON c.run_id = r.id
        GROUP BY r.id
        ORDER BY r.updated_at DESC
        LIMIT $1
      `,
      [Math.max(1, Math.min(limit, 100))],
    );
    return result.rows.map(toRunSummary);
  } finally {
    await postgres.disconnect();
  }
}

export async function getReviewRun(id: string): Promise<ReviewRunRecord> {
  await ensureReviewRunTables();
  const postgres = createPostgresClient('vioscope-review-runs');

  try {
    const runResult = await postgres.pool.query<ReviewRunRow>(
      `
        SELECT id::text, project_name, draft_name, target_venue, deadline, initiator,
          pi_or_senior_reviewer, cooperators, reviewer, metadata, created_at, updated_at
        FROM review_runs
        WHERE id = $1
      `,
      [id],
    );
    const run = runResult.rows[0];
    if (!run) {
      throw new Error(`Review run not found: ${id}`);
    }

    const checksResult = await postgres.pool.query<ReviewCheckRow>(
      `
        SELECT id::text, skill_name, skill_label, verdict, report_markdown, result_json,
          signoff_status, reviewer_note, signed_off_by, signed_off_at, created_at, updated_at
        FROM review_check_results
        WHERE run_id = $1
        ORDER BY skill_name
      `,
      [id],
    );

    return {
      ...toRunBase(run),
      metadata: metadataObject(run.metadata),
      checks: checksResult.rows.map(toCheckRecord),
    };
  } finally {
    await postgres.disconnect();
  }
}

export async function updateReviewCheckSignoff(input: {
  runId: string;
  skillName: string;
  signoffStatus: ReviewSignoffStatus;
  reviewerNote?: string;
  signedOffBy?: string;
}): Promise<ReviewRunRecord> {
  await ensureReviewRunTables();
  const postgres = createPostgresClient('vioscope-review-runs');

  try {
    const result = await postgres.pool.query<{ id: string }>(
      `
        UPDATE review_check_results
        SET
          signoff_status = $3,
          reviewer_note = $4,
          signed_off_by = $5,
          signed_off_at = CASE WHEN $3 = 'pending' THEN NULL ELSE now() END,
          updated_at = now()
        WHERE run_id = $1 AND skill_name = $2
        RETURNING id::text
      `,
      [
        input.runId,
        input.skillName,
        input.signoffStatus,
        input.reviewerNote?.trim() || '',
        nullableText(input.signedOffBy),
      ],
    );

    if (!result.rows[0]) {
      throw new Error(`Review check result not found for ${input.skillName}.`);
    }

    await postgres.pool.query('UPDATE review_runs SET updated_at = now() WHERE id = $1', [input.runId]);
    return getReviewRun(input.runId);
  } finally {
    await postgres.disconnect();
  }
}
