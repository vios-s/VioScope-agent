import { isDeepStrictEqual } from 'node:util';
import { seedProjectResearch } from './project-workflow';
import { projectSetupSchema } from '../projects/workflow';
import { validateIdeaReview, type SavedIdeaReview, type IdeaReview } from '../projects/idea-review-schema';
import { AuthError, canSeeAll } from '../auth/session';
import { createPostgresClient, withDatabaseTransaction } from './postgres';
import { createProject, getProjectForUser } from './projects';
import { ensureUsersTable, getUserByUsername, type AuthUser } from './users';
import { checkIdea, ideaDraftSchema, ideaCommandSchema, initialProjectActionSchema, type IdeaCommand, type IdeaRevision, type IdeaPitch } from '../projects/idea-check';

function canManage(pitch: IdeaPitch, user: AuthUser) {
  return user.provisioningStatus === 'active' && (pitch.ownerUsername === user.username || canSeeAll(user));
}
async function ensureTable() {
  await ensureUsersTable();
  await withDatabaseTransaction(async () => {
    const db = createPostgresClient();
    await db.pool.query("SELECT pg_advisory_xact_lock(hashtext('vioscope-idea-pitches-schema'))");
    await db.pool.query(`CREATE TABLE IF NOT EXISTS idea_pitches (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), title TEXT NOT NULL, owner_username TEXT NOT NULL,
      project_id UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await db.pool.query(`CREATE TABLE IF NOT EXISTS idea_pitch_collaborators (
      pitch_id UUID NOT NULL REFERENCES idea_pitches(id) ON DELETE CASCADE,
      username TEXT NOT NULL REFERENCES users(username), PRIMARY KEY(pitch_id, username)
    )`);
    await db.pool.query(`CREATE TABLE IF NOT EXISTS idea_pitch_revisions (
      pitch_id UUID NOT NULL REFERENCES idea_pitches(id) ON DELETE CASCADE,
      version INTEGER NOT NULL CHECK (version > 0), payload JSONB NOT NULL, by_username TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (pitch_id, version)
    )`);
    await db.pool.query(`CREATE TABLE IF NOT EXISTS project_idea_origins (
      project_id UUID PRIMARY KEY, snapshot JSONB NOT NULL
    )`);
    await db.pool.query(`CREATE TABLE IF NOT EXISTS idea_pitch_reviews (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), pitch_id UUID NOT NULL REFERENCES idea_pitches(id),
      pitch_version INTEGER NOT NULL, report JSONB NOT NULL, rules_hash TEXT NOT NULL,
      rules_snapshot TEXT NOT NULL, model TEXT NOT NULL, by_username TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  });
}
export async function listIdeaPitches(user: AuthUser): Promise<IdeaPitch[]> {
  await ensureTable();
  if (user.provisioningStatus !== 'active') throw new AuthError('Active account required.', 403, 'forbidden');
  const result = await createPostgresClient().pool.query<IdeaPitch>(`SELECT p.id::text, p.title, p.owner_username AS "ownerUsername",
    p.project_id::text AS "projectId",
    CASE WHEN p.owner_username=$1 THEN 'owner' WHEN $2 THEN 'pi' ELSE 'shared' END AS access,
    COALESCE((SELECT MAX(version) FROM idea_pitch_revisions WHERE pitch_id=p.id),0) AS version,
    COALESCE((SELECT MAX(created_at) FROM idea_pitch_revisions WHERE pitch_id=p.id),p.created_at)::text AS "updatedAt", (SELECT payload->'decision'->>'outcome' FROM idea_pitch_revisions WHERE pitch_id=p.id ORDER BY version DESC LIMIT 1) AS outcome
    FROM idea_pitches p WHERE owner_username=$1 OR $2 OR EXISTS(SELECT 1 FROM idea_pitch_collaborators c WHERE c.pitch_id=p.id AND c.username=$1) ORDER BY "updatedAt" DESC`, [user.username, canSeeAll(user)]);
  return result.rows;
}
export async function createIdeaPitch(title: string, user: AuthUser) {
  await ensureTable();
  const result = await createPostgresClient().pool.query<{ id: string }>('INSERT INTO idea_pitches(title,owner_username) VALUES($1,$2) RETURNING id::text', [title, user.username]);
  return result.rows[0];
}
async function pitchForUser(id: string, user: AuthUser, allowShared = false): Promise<IdeaPitch> {
  const result = await createPostgresClient().pool.query<IdeaPitch>('SELECT id::text,title,owner_username AS "ownerUsername",project_id::text AS "projectId" FROM idea_pitches WHERE id=$1', [id]);
  const pitch = result.rows[0];
  const shared = pitch && allowShared && user.provisioningStatus === 'active' && (await createPostgresClient().pool.query('SELECT 1 FROM idea_pitch_collaborators WHERE pitch_id=$1 AND username=$2', [id, user.username])).rowCount;
  if (!pitch || (!canManage(pitch, user) && !shared)) throw new AuthError('Idea pitch is unavailable.', 403, 'forbidden');
  return pitch;
}
async function revisions(id: string, latestOnly = false): Promise<IdeaRevision[]> {
  const result = await createPostgresClient().pool.query<{ version: number; payload: Pick<IdeaRevision, 'title' | 'draft' | 'source' | 'decision' | 'operation'>; by_username: string; at: string }>(
    'SELECT version,payload,by_username,created_at::text AS at FROM idea_pitch_revisions WHERE pitch_id=$1 ORDER BY version DESC LIMIT $2', [id, latestOnly ? 1 : null]);
  return result.rows.map((row) => ({ ...row.payload, draft: ideaDraftSchema.parse(row.payload.draft), version: row.version, by: row.by_username, at: row.at }));
}
export async function getIdeaCheck(id: string, user: AuthUser) {
  await ensureTable();
  const pitch = await pitchForUser(id, user, true);
  const manager = canManage(pitch, user);
  const history = await revisions(id, !manager);
  if (!manager) return { pitch, current: history[0] ? { ...history[0], source: null } : null, history: [], reviews: [], canEdit: false, canManage: false, collaborators: [] as string[] };
  const collaborators = await createPostgresClient().pool.query<{ username: string }>('SELECT username FROM idea_pitch_collaborators WHERE pitch_id=$1 ORDER BY username', [id]);
  const reviews = await createPostgresClient().pool.query<SavedIdeaReview>(`SELECT id::text,pitch_version AS "pitchVersion",report,rules_hash AS "rulesHash",model,by_username AS by,created_at::text AS at FROM idea_pitch_reviews WHERE pitch_id=$1 ORDER BY created_at DESC`, [id]);
  return { pitch, current: history[0] || null, history, reviews: reviews.rows, canEdit: !pitch.projectId, canManage: true, collaborators: collaborators.rows.map(row => row.username) };
}
export async function writeIdeaCheck(id: string, input: IdeaCommand, user: AuthUser) {
  const command = ideaCommandSchema.parse(input);
  await ensureTable();
  return withDatabaseTransaction(async () => {
    const db = createPostgresClient();
    await db.pool.query('SELECT id FROM idea_pitches WHERE id=$1 FOR UPDATE', [id]);
    const pitch = await pitchForUser(id, user);
    if (pitch.projectId) throw new Error('This pitch has already become a project. Its approval record is retained read-only.');
    const current = (await revisions(id, true))[0];
    if ((current?.version || 0) !== command.version) throw new AuthError('This pitch changed. Reload before saving.', 409, 'conflict');
    const draft = command.operation === 'save' ? command.draft : current?.draft;
    if (!draft) throw new Error('Save the pitch before recording a decision.');
    if (command.operation === 'decide' && command.decision.outcome === 'proceed' && checkIdea(draft).some((item) => !item.present)) {
      throw new Error('Fill the missing sections before confirming Proceed. Completed fields still require human review.');
    }
    const title = command.operation === 'save' && command.title !== undefined
      ? command.title : pitch.title;
    // An unchanged save is a no-op: no new version, and the current human decision stays in force.
    if (command.operation === 'save' && current && title === (current.title ?? pitch.title) && isDeepStrictEqual(draft, current.draft)
      && isDeepStrictEqual(command.source ?? null, current.source ?? null)) return { version: current.version, unchanged: true };
    await db.pool.query('UPDATE idea_pitches SET title=$2 WHERE id=$1', [id, title]);
    const payload = { title, draft, source: command.operation === 'save' ? command.source : current?.source || null, decision: command.operation === 'decide' ? command.decision : null, operation: command.operation };
    await db.pool.query('INSERT INTO idea_pitch_revisions(pitch_id,version,payload,by_username) VALUES($1,$2,$3::jsonb,$4)',
      [id, command.version + 1, JSON.stringify(payload), user.username]);
    return { version: command.version + 1 };
  });
}
export async function createProjectFromPitch(id: string, version: number, user: AuthUser, initialAction?: { text: string; dueDate: string }, setup?: unknown) {
  await ensureTable();
  return withDatabaseTransaction(async () => {
    const db = createPostgresClient();
    await db.pool.query('SELECT id FROM idea_pitches WHERE id=$1 FOR UPDATE', [id]);
    const pitch = await pitchForUser(id, user);
    if (pitch.projectId) return { projectId: pitch.projectId, created: false };
    const current = (await revisions(id, true))[0];
    if (current?.version !== version) throw new AuthError('This pitch changed. Reload before creating the project.', 409, 'conflict');
    if (current.decision?.outcome !== 'proceed') throw new Error('A confirmed Proceed decision is required before creating a project.');
    const assignments = setup ? projectSetupSchema.parse(setup) : undefined;
    if (assignments) for (const username of assignments.collaborators) { const account=await getUserByUsername(username); if(!account||account.provisioningStatus!=='active') throw new Error('Project collaborators must be active accounts.'); }
    const project = await createProject({ ...assignments, title: pitch.title, ownerUsername: pitch.ownerUsername, stage: 1, target: current.decision.nextMilestone, todos: initialAction ? [initialProjectActionSchema.parse(initialAction)] : [] }, user);
    await seedProjectResearch(project.id,{phase:'initial_validation',question:current.draft.why,claim:current.draft.strategy,validation:current.draft.execution,resourceNotes:current.draft.resourcePlan,risks:current.draft.risks},user.username);
    await db.pool.query('INSERT INTO project_idea_origins(project_id,snapshot) VALUES($1,$2::jsonb)', [project.id,
      JSON.stringify({ title: pitch.title, draft: current.draft, decision: current.decision, approvedBy: current.by, approvedAt: current.at, version: current.version })]);
    await db.pool.query('UPDATE idea_pitches SET project_id=$2 WHERE id=$1', [id, project.id]);
    return { projectId: project.id, created: true };
  });
}

export async function saveIdeaReview(id: string, version: number, review: { report: IdeaReview; rules: string; rulesHash: string; model: string }, user: AuthUser) {
  await ensureTable();
  return withDatabaseTransaction(async () => {
    const db = createPostgresClient();
    await db.pool.query('SELECT id FROM idea_pitches WHERE id=$1 FOR UPDATE', [id]);
    const pitch = await pitchForUser(id, user);
    const current = (await revisions(id, true))[0];
    if (pitch.projectId || current?.version !== version) throw new AuthError('The pitch changed during review. Save and review the current draft again.', 409, 'conflict');
    validateIdeaReview(review.report, current.draft);
    const result = await db.pool.query<{ id: string }>(`INSERT INTO idea_pitch_reviews(pitch_id,pitch_version,report,rules_hash,rules_snapshot,model,by_username) VALUES($1,$2,$3::jsonb,$4,$5,$6,$7) RETURNING id::text`,
      [id, version, JSON.stringify(review.report), review.rulesHash, review.rules, review.model, user.username]);
    return result.rows[0];
  });
}

export async function getProjectIdeaOrigin(projectId: string, user: AuthUser) {
  const project = await getProjectForUser(projectId, user);
  await ensureTable();
  const result = await createPostgresClient().pool.query('SELECT snapshot FROM project_idea_origins WHERE project_id=$1', [project.id]);
  return result.rows[0]?.snapshot || null;
}

export async function deleteIdeaPitch(id: string, version: number, user: AuthUser) {
  await ensureTable();
  return withDatabaseTransaction(async () => {
    const db = createPostgresClient();
    await db.pool.query('SELECT id FROM idea_pitches WHERE id=$1 FOR UPDATE', [id]);
    const pitch = await pitchForUser(id, user);
    if (pitch.projectId) throw new Error('This pitch is a project starting record and cannot be deleted.');
    const current = (await revisions(id, true))[0];
    if ((current?.version || 0) !== version) throw new AuthError('This pitch changed. Reload before deleting.', 409, 'conflict');
    await db.pool.query('DELETE FROM idea_pitch_reviews WHERE pitch_id=$1', [id]);
    await db.pool.query('DELETE FROM idea_pitches WHERE id=$1', [id]);
    return { deleted: true };
  });
}

export async function changeIdeaCollaborator(id: string, username: string, action: 'add' | 'remove', actor: AuthUser) {
  await ensureTable();
  return withDatabaseTransaction(async () => {
    const db = createPostgresClient();
    await db.pool.query('SELECT id FROM idea_pitches WHERE id=$1 FOR UPDATE', [id]);
    const pitch = await pitchForUser(id, actor);
    if (action === 'add') {
      const account = await getUserByUsername(username);
      if (!account || account.username !== username || account.provisioningStatus !== 'active') throw new Error('Choose an active account username.');
      if (username === pitch.ownerUsername || canSeeAll(account)) throw new Error('The proposer, PI and administrator already have access.');
      await db.pool.query('INSERT INTO idea_pitch_collaborators(pitch_id,username) VALUES($1,$2) ON CONFLICT DO NOTHING', [id, username]);
    } else await db.pool.query('DELETE FROM idea_pitch_collaborators WHERE pitch_id=$1 AND username=$2', [id, username]);
    return { username, action };
  });
}
