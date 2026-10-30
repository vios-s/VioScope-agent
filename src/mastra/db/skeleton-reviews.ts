import {projectPIs} from '../projects/review-team';
import { isDeepStrictEqual } from 'node:util';
import { AuthError, canSeeAll } from '../auth/session';
import type { AuthUser } from './users';
import { createPostgresClient, withDatabaseTransaction } from './postgres';
import { ensureProjectTables, getProjectForUser, listProjectsForUser } from './projects';
import { assertSkeletonStage, skeletonDecisionSchema, skeletonProjectSnapshot, latestSkeletonDecisions, type SkeletonRecord, type SkeletonProjectSnapshot } from '../submission/skeleton-record';
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
  // Latest check per project plus its check count; earlier checks of one project come from projectSkeletonReviewChoices.
  const result = await createPostgresClient().pool.query(`SELECT DISTINCT ON (project_id) id::text, project_id AS "projectId", created_at::text AS "createdAt", revision,
    project_snapshot AS "projectSnapshot", decisions, result->'structured'->>'verdict' AS verdict,
    (count(*) OVER (PARTITION BY project_id))::int AS count FROM skeleton_reviews
    WHERE project_id = ANY($1::uuid[]) ORDER BY project_id, created_at DESC, id DESC`, [ids]);
  return { projects, reviews: result.rows, viewer: { username: user.username, manager: canSeeAll(user), administrator: user.role === 'administrator' } };
}
export async function projectSkeletonReviewChoices(projectId: string, user: AuthUser) {
  await ensureTable();
  await getProjectForUser(projectId,user);
  return (await createPostgresClient().pool.query(`SELECT id::text,created_at AS "createdAt",created_by AS "createdBy",revision FROM skeleton_reviews WHERE project_id=$1 ORDER BY created_at DESC,id DESC`,[projectId])).rows;
}
export async function getSkeletonReview(id: string, user: AuthUser): Promise<SkeletonRecord> {
  await ensureTable();
  const row = (await createPostgresClient().pool.query(`SELECT ${columns} FROM skeleton_reviews WHERE id=$1`, [id])).rows[0];
  // Missing and inaccessible checks look the same, so the response never reveals another project's check.
  if (!row) throw new AuthError('Skeleton review not found.', 404, 'not_found');
  await getProjectForUser(row.projectId, user).catch(() => { throw new AuthError('Skeleton review not found.', 404, 'not_found'); });
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
    assertSkeletonStage(project);
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
    // Separation of duties: the owner never judges their own project, one person never records both steps, and an
    // administrator who is not the assigned reviewer acts only through an explicit, recorded override.
    if (project.ownerUsername === user.username) throw new AuthError('The project owner cannot record the PDRA judgment or PI confirmation for their own project.', 403, 'forbidden');
    const assigned = command.kind === 'pdra' ? project.pdraUsername === user.username : projectPIs(project).includes(user.username);
    const override = !assigned;
    if (override && (user.role !== 'administrator' || !command.override)) throw new AuthError(command.kind === 'pdra'
      ? 'Only the assigned PDRA can record the PDRA judgment. An administrator may record it only as an explicit administrator override.'
      : 'Only the project PI can record the confirmation. An administrator may record it only as an explicit administrator override.', 403, 'forbidden');
    const latestDecisions = latestSkeletonDecisions(record.decisions);
    if (command.kind === 'pdra') {
      if (record.decisions.some(item => item.kind === 'pi' && item.by === user.username)) throw new AuthError('You recorded the PI confirmation for this review, so another person must record the PDRA judgment.', 403, 'forbidden');
    } else {
      const pdra = latestDecisions.pdra;
      if (!pdra) throw new Error('Record the PDRA judgment before PI skeleton checkpoint confirmation.');
      if (pdra.by === user.username) throw new AuthError('You recorded the PDRA judgment for this review, so another person must record the PI confirmation.', 403, 'forbidden');
      if (command.outcome === 'approved' && pdra.outcome === 'revise') throw new Error('The PDRA requested revision. Resolve it before skeleton approval.');
      if (command.outcome === 'approved' && pdra.outcome === 'SLIDE') throw new Error('The PDRA judged that this project should slide to the next submission cycle. Run a new check before skeleton approval.');
    }
    const decision = { kind: command.kind, outcome: command.outcome, ...(command.kind === 'pdra' && command.reevaluateOn ? { reevaluateOn: command.reevaluateOn } : {}), note: command.note, by: user.username, at: new Date().toISOString(), ...(override ? { override: true } : {}) };
    const saved = await db.pool.query(`UPDATE skeleton_reviews SET decisions=decisions || $2::jsonb,revision=revision+1 WHERE id=$1 RETURNING ${columns}`, [id,JSON.stringify([decision])]);
    return saved.rows[0] as SkeletonRecord;
  });
}
