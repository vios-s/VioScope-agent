import { isDeepStrictEqual } from 'node:util';
import { AuthError, canSeeAll } from '../auth/session';
import type { AuthUser } from './users';
import { createPostgresClient, withDatabaseTransaction } from './postgres';
import { ensureProjectTables, getProjectForUser, listProjectsForUser } from './projects';
import { skeletonDecisionSchema, skeletonProjectSnapshot, latestSkeletonDecisions, type SkeletonRecord, type SkeletonProjectSnapshot } from '../submission/skeleton-record';
import type { SubmissionReviewResult } from '../submission/review';

async function ensureTable() {
  await ensureProjectTables();
  await createPostgresClient().pool.query(`CREATE TABLE IF NOT EXISTS skeleton_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), project_id UUID NOT NULL REFERENCES project_records(id) ON DELETE CASCADE,
    created_by TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), revision INTEGER NOT NULL DEFAULT 0,
    project_snapshot JSONB NOT NULL, draft_text TEXT NOT NULL, result JSONB NOT NULL, decisions JSONB NOT NULL DEFAULT '[]'::jsonb
  )`);
}
const columns = `id::text, project_id AS "projectId", created_by AS "createdBy", created_at::text AS "createdAt", revision,
  project_snapshot AS "projectSnapshot", draft_text AS "draftText", result, decisions`;
export async function listSkeletonReviews(user: AuthUser) {
  await ensureTable();
  const projects = await listProjectsForUser(user, { includeArchived: true });
  const ids = projects.map(project => project.id);
  const result = await createPostgresClient().pool.query(`SELECT id::text, project_id AS "projectId", created_at::text AS "createdAt", revision,
    project_snapshot AS "projectSnapshot", decisions, result->'structured'->>'verdict' AS verdict FROM skeleton_reviews
    WHERE project_id = ANY($1::uuid[]) ORDER BY created_at DESC LIMIT 200`, [ids]);
  return { projects, reviews: result.rows, viewer: { username: user.username, manager: canSeeAll(user), administrator: user.role === 'administrator' } };
}
export async function getSkeletonReview(id: string, user: AuthUser): Promise<SkeletonRecord> {
  await ensureTable();
  const row = (await createPostgresClient().pool.query(`SELECT ${columns} FROM skeleton_reviews WHERE id=$1`, [id])).rows[0];
  if (!row) throw new Error('Skeleton review not found.');
  await getProjectForUser(row.projectId, user);
  return row;
}
async function lockProject(projectId: string, user: AuthUser) {
  const project = await getProjectForUser(projectId, user);
  const row = (await createPostgresClient().pool.query('SELECT updated_at FROM project_records WHERE id=$1 FOR UPDATE', [projectId])).rows[0];
  if (!row || new Date(row.updated_at).toISOString() !== project.updatedAt) throw new AuthError('Project changed. Reload before continuing.', 409, 'conflict');
  return project;
}
export async function saveSkeletonReview(projectId: string, snapshot: SkeletonProjectSnapshot, draftText: string, result: SubmissionReviewResult, user: AuthUser) {
  await ensureTable();
  return withDatabaseTransaction(async () => {
    const project = await lockProject(projectId, user);
    if (project.lifecycle !== 'active') throw new Error('Only active projects can receive a new check.');
    if (!project.access.canEdit) throw new AuthError('Only the project owner, PI or administrator can request a check.', 403, 'forbidden');
    if (!isDeepStrictEqual(skeletonProjectSnapshot(project), snapshot)) throw new AuthError('Project details changed during the AI check. Reload and check again.', 409, 'conflict');
    const saved = await createPostgresClient().pool.query(`INSERT INTO skeleton_reviews(project_id,created_by,project_snapshot,draft_text,result)
      VALUES($1,$2,$3::jsonb,$4,$5::jsonb) RETURNING ${columns}`, [projectId,user.username,JSON.stringify(snapshot),draftText,JSON.stringify(result)]);
    return saved.rows[0] as SkeletonRecord;
  });
}
export async function decideSkeletonReview(id: string, input: unknown, user: AuthUser) {
  const command = skeletonDecisionSchema.parse(input);
  const initial = await getSkeletonReview(id, user);
  return withDatabaseTransaction(async () => {
    const project = await lockProject(initial.projectId, user);
    if (project.lifecycle !== 'active') throw new Error('Only active projects can receive a judgment.');
    const db = createPostgresClient();
    const record = (await db.pool.query(`SELECT ${columns} FROM skeleton_reviews WHERE id=$1 FOR UPDATE`, [id])).rows[0] as SkeletonRecord;
    if (record.revision !== command.revision) throw new AuthError('This review changed. Reload before recording a judgment.', 409, 'conflict');
    const latest = (await db.pool.query('SELECT id::text FROM skeleton_reviews WHERE project_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1', [project.id])).rows[0];
    if (latest.id !== id) throw new AuthError('A newer AI check exists. Review the latest version.', 409, 'conflict');
    if (!isDeepStrictEqual(skeletonProjectSnapshot(project), record.projectSnapshot)) throw new AuthError('Project details changed. Run a new AI check before judging.', 409, 'conflict');
    if (command.kind === 'pdra') {
      if (project.pdraUsername !== user.username && user.role !== 'administrator') throw new AuthError('Only the assigned PDRA or administrator can record the PDRA verdict.', 403, 'forbidden');
    } else {
      if (!canSeeAll(user)) throw new AuthError('Only a PI or administrator can record final confirmation.', 403, 'forbidden');
      const pdra = latestSkeletonDecisions(record.decisions).pdra;
      if (!pdra) throw new Error('Record the PDRA judgment before final PI confirmation.');
      if (command.outcome === 'approved' && pdra.outcome === 'revise') throw new Error('The PDRA requested revision. Resolve it before final approval.');
    }
    const decision = { kind: command.kind, outcome: command.outcome, note: command.note, by: user.username, at: new Date().toISOString() };
    const saved = await db.pool.query(`UPDATE skeleton_reviews SET decisions=decisions || $2::jsonb,revision=revision+1 WHERE id=$1 RETURNING ${columns}`, [id,JSON.stringify([decision])]);
    return saved.rows[0] as SkeletonRecord;
  });
}
