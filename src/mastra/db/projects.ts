import { canSeeAll, isUserName } from '../auth/session';
import { canManageTheme } from '../theme-meetings/access';
import { readThemeMeetingConfig } from '../theme-meetings/store';
import { createPostgresClient } from './postgres';
import { ensureUsersTable, getUserByUsername, type AuthUser } from './users';

export const projectStatuses = ['on_track', 'blocked', 'stale', 'needs_input'] as const;
export const projectLifecycles = ['active', 'paused', 'finished', 'archived'] as const;
export const projectUpdateTypes = ['progress', 'note', 'decision', 'blocker', 'artifact'] as const;
export const projectTracks = ['A', 'B'] as const;

export type ProjectStatus = (typeof projectStatuses)[number];
export type ProjectLifecycle = (typeof projectLifecycles)[number];
export type ProjectUpdateType = (typeof projectUpdateTypes)[number];
export type ProjectTrack = (typeof projectTracks)[number];

export type ProjectArtifactInput = {
  title?: string;
  kind?: string;
  path?: string;
  summary?: string;
  artifactKey?: string;
};

export type ProjectCreateInput = {
  project?: string;
  title?: string;
  ownerUsername?: string;
  collaborators?: string[];
  track?: string;
  stage?: number;
  lifecycle?: ProjectLifecycle;
  status?: ProjectStatus;
  stageSince?: string | null;
  lastUpdate?: string | null;
  blocker?: string | null;
  target?: string | null;
  venue?: string | null;
  submissionDeadline?: string | null;
  watchPath?: string | null;
  notes?: string | null;
};

export type ProjectUpdateInput = Partial<ProjectCreateInput>;

export type AddProjectUpdateInput = {
  date?: string | null;
  type?: ProjectUpdateType;
  text: string;
  artifact?: ProjectArtifactInput | null;
};

export type ProjectArtifactRecord = {
  id: string;
  title: string;
  kind: string;
  path: string | null;
  summary: string;
  artifactKey: string;
  isCurrent: boolean;
  sourceUpdateId: string | null;
  uploadedByUsername: string | null;
  createdAt: string;
};

export type ProjectUpdateCommentRecord = {
  id: string;
  updateId: string;
  byUsername: string;
  text: string;
  createdAt: string;
};

export type ProjectUpdateRecord = {
  id: string;
  date: string;
  byUsername: string;
  type: ProjectUpdateType;
  text: string;
  artifactIds: string[];
  comments: ProjectUpdateCommentRecord[];
  createdAt: string;
};

export type ProjectRecord = {
  id: string;
  project: string;
  title: string;
  ownerUsername: string;
  collaborators: string[];
  track: string;
  stage: number;
  lifecycle: ProjectLifecycle;
  status: ProjectStatus;
  stageSince: string | null;
  lastUpdate: string | null;
  blocker: string | null;
  target: string | null;
  venue: string | null;
  submissionDeadline: string | null;
  watchPath: string | null;
  notes: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  artifacts: ProjectArtifactRecord[];
  updates: ProjectUpdateRecord[];
  access: {
    canEdit: boolean;
    canArchive: boolean;
    canAddUpdate: boolean;
    canComment: boolean;
    reason: 'owner' | 'collaborator' | 'coordinator' | 'pi_admin';
  };
};

type ProjectRow = {
  id: string;
  slug: string;
  title: string;
  owner_username: string;
  collaborator_usernames: string[] | null;
  track: string;
  stage: number | string;
  lifecycle: ProjectLifecycle;
  status: ProjectStatus;
  stage_since: string | Date | null;
  last_update: string | Date | null;
  blocker: string | null;
  target: string | null;
  venue: string | null;
  submission_deadline: string | Date | null;
  watch_path: string | null;
  notes: string | null;
  archived_at: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
};

type ArtifactRow = {
  id: string;
  project_id: string;
  title: string;
  kind: string;
  path: string | null;
  summary: string;
  artifact_key: string;
  is_current: boolean;
  source_update_id: string | null;
  uploaded_by_username: string | null;
  created_at: string | Date;
};

type UpdateRow = {
  id: string;
  project_id: string;
  update_date: string | Date;
  by_username: string;
  update_type: ProjectUpdateType;
  text: string;
  artifact_ids: string[] | null;
  created_at: string | Date;
};

type CommentRow = {
  id: string;
  update_id: string;
  by_username: string;
  text: string;
  created_at: string | Date;
};

let ensureProjectTablesPromise: Promise<void> | null = null;

function cleanText(value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed || null;
}

function cleanSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 96);
}

function cleanUsername(value: string): string {
  return value.trim().toLowerCase();
}

function cleanUsernames(values?: string[]): string[] {
  return [...new Set((values || []).map(cleanUsername).filter(Boolean))];
}

function cleanTrack(value?: string | null): ProjectTrack {
  const track = value?.trim().toUpperCase();
  if (track === 'A' || track === 'B') return track;
  throw new Error('Track must be A or B.');
}

function defaultWatchPath(ownerUsername: string, slug: string): string {
  return `project://${ownerUsername}/${slug}`;
}

function cleanDate(value?: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new Error('Dates must use YYYY-MM-DD.');
  }
  return trimmed;
}

function dateOnly(value: string | Date | null): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value.slice(0, 10);
}

function isoDate(value: string | Date | null): string | null {
  return value ? new Date(value).toISOString() : null;
}

function titleFromSlug(slug: string): string {
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function isProjectStatus(value?: string): value is ProjectStatus {
  return projectStatuses.includes(value as ProjectStatus);
}

function isProjectLifecycle(value?: string): value is ProjectLifecycle {
  return projectLifecycles.includes(value as ProjectLifecycle);
}

function isProjectUpdateType(value?: string): value is ProjectUpdateType {
  return projectUpdateTypes.includes(value as ProjectUpdateType);
}

async function coordinatorTracksForUser(user: AuthUser): Promise<Set<string>> {
  try {
    const { config } = await readThemeMeetingConfig();
    return new Set(
      config.themes
        .filter((theme) => canManageTheme(config, theme.theme_id, user))
        .map((theme) => theme.theme_id.toLowerCase()),
    );
  } catch {
    return new Set();
  }
}

function accessReason(row: ProjectRow, user: AuthUser, coordinatorTracks: Set<string>): ProjectRecord['access']['reason'] | null {
  const username = cleanUsername(user.username);
  if (canSeeAll(user)) return 'pi_admin';
  if (cleanUsername(row.owner_username) === username || isUserName(row.owner_username, user)) return 'owner';
  if ((row.collaborator_usernames || []).map(cleanUsername).includes(username)) return 'collaborator';
  if (coordinatorTracks.has(row.track.toLowerCase())) return 'coordinator';
  return null;
}

function canEditFromReason(reason: ProjectRecord['access']['reason']): boolean {
  return reason === 'owner' || reason === 'collaborator' || reason === 'pi_admin';
}

function toArtifact(row: ArtifactRow): ProjectArtifactRecord {
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    path: row.path,
    summary: row.summary,
    artifactKey: row.artifact_key,
    isCurrent: row.is_current,
    sourceUpdateId: row.source_update_id,
    uploadedByUsername: row.uploaded_by_username,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function toUpdate(row: UpdateRow, comments: ProjectUpdateCommentRecord[]): ProjectUpdateRecord {
  return {
    id: row.id,
    date: dateOnly(row.update_date) || new Date(row.created_at).toISOString().slice(0, 10),
    byUsername: row.by_username,
    type: row.update_type,
    text: row.text,
    artifactIds: row.artifact_ids || [],
    comments,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function toProject(
  row: ProjectRow,
  user: AuthUser,
  coordinatorTracks: Set<string>,
  artifacts: ProjectArtifactRecord[],
  updates: ProjectUpdateRecord[],
): ProjectRecord | null {
  const reason = accessReason(row, user, coordinatorTracks);
  if (!reason) return null;
  const canEdit = canEditFromReason(reason);

  return {
    id: row.id,
    project: row.slug,
    title: row.title,
    ownerUsername: row.owner_username,
    collaborators: row.collaborator_usernames || [],
    track: row.track,
    stage: Number(row.stage),
    lifecycle: row.lifecycle,
    status: row.status,
    stageSince: dateOnly(row.stage_since),
    lastUpdate: dateOnly(row.last_update),
    blocker: row.blocker,
    target: row.target,
    venue: row.venue,
    submissionDeadline: dateOnly(row.submission_deadline),
    watchPath: row.watch_path,
    notes: row.notes,
    archivedAt: isoDate(row.archived_at),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    artifacts,
    updates,
    access: {
      canEdit,
      canArchive: canEdit,
      canAddUpdate: canEdit,
      canComment: Boolean(reason),
      reason,
    },
  };
}

export async function ensureProjectTables(): Promise<void> {
  ensureProjectTablesPromise ||= ensureProjectTablesOnce().catch((error) => {
    ensureProjectTablesPromise = null;
    throw error;
  });
  return ensureProjectTablesPromise;
}

async function ensureProjectTablesOnce(): Promise<void> {
  await ensureUsersTable();
  const postgres = createPostgresClient('vioscope-projects');

  try {
    await postgres.pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
    await postgres.pool.query(`
      CREATE TABLE IF NOT EXISTS project_records (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        slug TEXT NOT NULL,
        title TEXT NOT NULL,
        owner_username TEXT NOT NULL,
        collaborator_usernames TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
        track TEXT NOT NULL DEFAULT 'A' CHECK (track IN ('A', 'B')),
        stage INTEGER NOT NULL DEFAULT 1 CHECK (stage BETWEEN 1 AND 5),
        lifecycle TEXT NOT NULL DEFAULT 'active' CHECK (lifecycle IN ('active', 'paused', 'finished', 'archived')),
        status TEXT NOT NULL DEFAULT 'on_track' CHECK (status IN ('on_track', 'blocked', 'stale', 'needs_input')),
        stage_since DATE,
        last_update DATE,
        blocker TEXT,
        target TEXT,
        venue TEXT,
        submission_deadline DATE,
        watch_path TEXT,
        notes TEXT,
        archived_at TIMESTAMPTZ,
        created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await postgres.pool.query('ALTER TABLE project_records DROP CONSTRAINT IF EXISTS project_records_slug_key');
    await postgres.pool.query("UPDATE project_records SET track = 'A' WHERE track NOT IN ('A', 'B')");
    await postgres.pool.query("ALTER TABLE project_records ALTER COLUMN track SET DEFAULT 'A'");
    await postgres.pool.query(`
      DO $$
      BEGIN
        ALTER TABLE project_records
          ADD CONSTRAINT project_records_track_check CHECK (track IN ('A', 'B'));
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;
    `);
    await postgres.pool.query(`
      CREATE TABLE IF NOT EXISTS project_artifacts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id UUID NOT NULL REFERENCES project_records(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'other',
        path TEXT,
        summary TEXT NOT NULL DEFAULT '',
        artifact_key TEXT NOT NULL,
        is_current BOOLEAN NOT NULL DEFAULT true,
        source_update_id UUID,
        uploaded_by_username TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        deleted_at TIMESTAMPTZ
      )
    `);
    await postgres.pool.query(`
      CREATE TABLE IF NOT EXISTS project_updates (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id UUID NOT NULL REFERENCES project_records(id) ON DELETE CASCADE,
        update_date DATE NOT NULL DEFAULT CURRENT_DATE,
        by_username TEXT NOT NULL,
        update_type TEXT NOT NULL DEFAULT 'progress' CHECK (update_type IN ('progress', 'note', 'decision', 'blocker', 'artifact')),
        text TEXT NOT NULL,
        artifact_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await postgres.pool.query(`
      CREATE TABLE IF NOT EXISTS project_update_comments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        update_id UUID NOT NULL REFERENCES project_updates(id) ON DELETE CASCADE,
        by_username TEXT NOT NULL,
        text TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await postgres.pool.query('CREATE INDEX IF NOT EXISTS project_records_owner_idx ON project_records (owner_username)');
    await postgres.pool.query('CREATE UNIQUE INDEX IF NOT EXISTS project_records_owner_slug_idx ON project_records (lower(owner_username), slug)');
    await postgres.pool.query('CREATE INDEX IF NOT EXISTS project_records_track_idx ON project_records (track)');
    await postgres.pool.query('CREATE INDEX IF NOT EXISTS project_records_lifecycle_idx ON project_records (lifecycle)');
    await postgres.pool.query('CREATE INDEX IF NOT EXISTS project_updates_project_idx ON project_updates (project_id, update_date DESC)');
    await postgres.pool.query('CREATE INDEX IF NOT EXISTS project_artifacts_project_idx ON project_artifacts (project_id, is_current)');
  } finally {
    await postgres.disconnect();
  }
}

async function hydrateProjects(rows: ProjectRow[], user: AuthUser): Promise<ProjectRecord[]> {
  if (!rows.length) return [];
  const coordinatorTracks = await coordinatorTracksForUser(user);
  const projectIds = rows.map((row) => row.id);
  const postgres = createPostgresClient('vioscope-projects');

  try {
    const artifactResult = await postgres.pool.query<ArtifactRow>(
      `
        SELECT id::text, project_id::text, title, kind, path, summary, artifact_key, is_current,
          source_update_id::text, uploaded_by_username, created_at
        FROM project_artifacts
        WHERE project_id = ANY($1::uuid[]) AND deleted_at IS NULL
        ORDER BY is_current DESC, created_at DESC
      `,
      [projectIds],
    );
    const updateResult = await postgres.pool.query<UpdateRow>(
      `
        SELECT id::text, project_id::text, update_date, by_username, update_type, text, artifact_ids::text[], created_at
        FROM project_updates
        WHERE project_id = ANY($1::uuid[])
        ORDER BY update_date DESC, created_at DESC
      `,
      [projectIds],
    );
    const updateIds = updateResult.rows.map((row: UpdateRow) => row.id);
    const commentResult = updateIds.length
      ? await postgres.pool.query<CommentRow>(
          `
            SELECT id::text, update_id::text, by_username, text, created_at
            FROM project_update_comments
            WHERE update_id = ANY($1::uuid[])
            ORDER BY created_at ASC
          `,
          [updateIds],
        )
      : { rows: [] as CommentRow[] };

    const artifactsByProject = new Map<string, ProjectArtifactRecord[]>();
    for (const row of artifactResult.rows) {
      const artifacts = artifactsByProject.get(row.project_id) || [];
      artifacts.push(toArtifact(row));
      artifactsByProject.set(row.project_id, artifacts);
    }

    const commentsByUpdate = new Map<string, ProjectUpdateCommentRecord[]>();
    for (const row of commentResult.rows) {
      const comments = commentsByUpdate.get(row.update_id) || [];
      comments.push({
        id: row.id,
        updateId: row.update_id,
        byUsername: row.by_username,
        text: row.text,
        createdAt: new Date(row.created_at).toISOString(),
      });
      commentsByUpdate.set(row.update_id, comments);
    }

    const updatesByProject = new Map<string, ProjectUpdateRecord[]>();
    for (const row of updateResult.rows) {
      const updates = updatesByProject.get(row.project_id) || [];
      updates.push(toUpdate(row, commentsByUpdate.get(row.id) || []));
      updatesByProject.set(row.project_id, updates);
    }

    return rows
      .map((row) =>
        toProject(
          row,
          user,
          coordinatorTracks,
          artifactsByProject.get(row.id) || [],
          updatesByProject.get(row.id) || [],
        ),
      )
      .filter((project): project is ProjectRecord => Boolean(project));
  } finally {
    await postgres.disconnect();
  }
}

export async function listProjectsForUser(user: AuthUser, input: { includeArchived?: boolean } = {}): Promise<ProjectRecord[]> {
  await ensureProjectTables();
  const postgres = createPostgresClient('vioscope-projects');

  try {
    const result = await postgres.pool.query<ProjectRow>(
      `
        SELECT id::text, slug, title, owner_username, collaborator_usernames, track, stage,
          lifecycle, status, stage_since, last_update, blocker, target, venue, submission_deadline,
          watch_path, notes, archived_at, created_at, updated_at
        FROM project_records
        WHERE ($1::boolean OR lifecycle <> 'archived')
        ORDER BY (lifecycle = 'archived') ASC, updated_at DESC
      `,
      [Boolean(input.includeArchived)],
    );
    return hydrateProjects(result.rows, user);
  } finally {
    await postgres.disconnect();
  }
}

async function projectRowsByIdOrSlug(projectId: string): Promise<ProjectRow[]> {
  await ensureProjectTables();
  const postgres = createPostgresClient('vioscope-projects');

  try {
    const result = await postgres.pool.query<ProjectRow>(
      `
        SELECT id::text, slug, title, owner_username, collaborator_usernames, track, stage,
          lifecycle, status, stage_since, last_update, blocker, target, venue, submission_deadline,
          watch_path, notes, archived_at, created_at, updated_at
        FROM project_records
        WHERE id::text = $1 OR slug = $1 OR lower(title) = lower($1)
        ORDER BY updated_at DESC
      `,
      [projectId],
    );
    return result.rows;
  } finally {
    await postgres.disconnect();
  }
}

async function assertActiveOwner(username: string): Promise<void> {
  const owner = await getUserByUsername(username);
  if (!owner || owner.provisioningStatus !== 'active') {
    throw new Error('Project owner must be an active user.');
  }
}

async function assertProjectNameAvailable(input: {
  ownerUsername: string;
  title: string;
  slug: string;
  excludeProjectId?: string;
}): Promise<void> {
  const postgres = createPostgresClient('vioscope-projects');

  try {
    const result = await postgres.pool.query<{ id: string; slug: string; title: string }>(
      `
        SELECT id::text, slug, title
        FROM project_records
        WHERE ($4::text IS NULL OR id::text <> $4)
          AND lower(owner_username) = lower($1)
          AND (
            slug = $2
            OR lower(title) = lower($3)
          )
        LIMIT 1
      `,
      [input.ownerUsername, input.slug, input.title, input.excludeProjectId || null],
    );
    const existing = result.rows[0];
    if (existing?.slug === input.slug) {
      throw new Error('Project slug already exists. Choose a different full project name.');
    }
    if (existing) {
      throw new Error('This owner already has a project with the same full project name.');
    }
  } finally {
    await postgres.disconnect();
  }
}

export async function getProjectForUser(projectId: string, user: AuthUser): Promise<ProjectRecord> {
  const projects = await hydrateProjects(await projectRowsByIdOrSlug(projectId), user);
  const project = projects[0];
  if (!project) {
    throw new Error('Project not found or access denied.');
  }
  return project;
}

export async function createProject(input: ProjectCreateInput, actor: AuthUser): Promise<ProjectRecord> {
  await ensureProjectTables();
  const slug = cleanSlug(input.project || input.title || '');
  if (!slug) throw new Error('Project slug is required.');
  const title = cleanText(input.title) || titleFromSlug(slug);

  const ownerUsername = cleanUsername(input.ownerUsername || actor.username);
  if (!canSeeAll(actor) && ownerUsername !== cleanUsername(actor.username)) {
    throw new Error('Only PI/admin can create a project for another owner.');
  }

  await assertActiveOwner(ownerUsername);
  const collaborators = cleanUsernames(input.collaborators);
  await assertProjectNameAvailable({ ownerUsername, title, slug });

  const stage = input.stage ?? 1;
  if (!Number.isInteger(stage) || stage < 1 || stage > 5) {
    throw new Error('Stage must be an integer from 1 to 5.');
  }
  const lifecycle = input.lifecycle || 'active';
  const status = input.status || 'on_track';
  if (!isProjectLifecycle(lifecycle)) throw new Error('Unsupported project lifecycle.');
  if (!isProjectStatus(status)) throw new Error('Unsupported project status.');

  const postgres = createPostgresClient('vioscope-projects');
  try {
    const result = await postgres.pool.query<ProjectRow>(
      `
        INSERT INTO project_records (
          slug, title, owner_username, collaborator_usernames, track, stage, lifecycle, status,
          stage_since, last_update, blocker, target, venue, submission_deadline, watch_path, notes,
          created_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::date, $10::date, $11, $12, $13, $14::date, $15, $16, $17)
        RETURNING id::text, slug, title, owner_username, collaborator_usernames, track, stage,
          lifecycle, status, stage_since, last_update, blocker, target, venue, submission_deadline,
          watch_path, notes, archived_at, created_at, updated_at
      `,
      [
        slug,
        title,
        ownerUsername,
        collaborators,
        cleanTrack(input.track || 'A'),
        stage,
        lifecycle,
        status,
        cleanDate(input.stageSince),
        cleanDate(input.lastUpdate),
        cleanText(input.blocker),
        cleanText(input.target),
        cleanText(input.venue),
        cleanDate(input.submissionDeadline),
        cleanText(input.watchPath) || defaultWatchPath(ownerUsername, slug),
        cleanText(input.notes),
        actor.id,
      ],
    );
    return (await hydrateProjects(result.rows, actor))[0]!;
  } finally {
    await postgres.disconnect();
  }
}

export async function updateProject(projectId: string, input: ProjectUpdateInput, actor: AuthUser): Promise<ProjectRecord> {
  const current = await getProjectForUser(projectId, actor);
  if (!current.access.canEdit) {
    throw new Error('You do not have permission to edit this project.');
  }
  const nextOwnerUsername = cleanUsername(input.ownerUsername || current.ownerUsername);
  if (nextOwnerUsername !== cleanUsername(current.ownerUsername) && !canSeeAll(actor)) {
    throw new Error('Only PI/admin can change the project owner.');
  }
  await assertActiveOwner(nextOwnerUsername);
  const nextCollaborators = input.collaborators === undefined ? current.collaborators : cleanUsernames(input.collaborators);
  const nextTitle = cleanText(input.title) || current.title;
  await assertProjectNameAvailable({
    ownerUsername: nextOwnerUsername,
    title: nextTitle,
    slug: current.project,
    excludeProjectId: current.id,
  });

  const nextStage = input.stage ?? current.stage;
  if (!Number.isInteger(nextStage) || nextStage < 1 || nextStage > 5) {
    throw new Error('Stage must be an integer from 1 to 5.');
  }
  const nextLifecycle = input.lifecycle || current.lifecycle;
  const nextStatus = input.status || current.status;
  if (!isProjectLifecycle(nextLifecycle)) throw new Error('Unsupported project lifecycle.');
  if (!isProjectStatus(nextStatus)) throw new Error('Unsupported project status.');

  const postgres = createPostgresClient('vioscope-projects');
  try {
    const result = await postgres.pool.query<ProjectRow>(
      `
        UPDATE project_records
        SET
          title = $2,
          owner_username = $3,
          collaborator_usernames = $4,
          track = $5,
          stage = $6,
          lifecycle = $7,
          status = $8,
          stage_since = $9::date,
          last_update = $10::date,
          blocker = $11,
          target = $12,
          venue = $13,
          submission_deadline = $14::date,
          watch_path = $15,
          notes = $16,
          archived_at = CASE WHEN $7 = 'archived' THEN COALESCE(archived_at, now()) ELSE NULL END,
          updated_at = now()
        WHERE id = $1
        RETURNING id::text, slug, title, owner_username, collaborator_usernames, track, stage,
          lifecycle, status, stage_since, last_update, blocker, target, venue, submission_deadline,
          watch_path, notes, archived_at, created_at, updated_at
      `,
      [
        current.id,
        nextTitle,
        nextOwnerUsername,
        nextCollaborators,
        cleanTrack(input.track || current.track),
        nextStage,
        nextLifecycle,
        nextStatus,
        input.stageSince === undefined ? current.stageSince : cleanDate(input.stageSince),
        input.lastUpdate === undefined ? current.lastUpdate : cleanDate(input.lastUpdate),
        input.blocker === undefined ? current.blocker : cleanText(input.blocker),
        input.target === undefined ? current.target : cleanText(input.target),
        input.venue === undefined ? current.venue : cleanText(input.venue),
        input.submissionDeadline === undefined ? current.submissionDeadline : cleanDate(input.submissionDeadline),
        input.watchPath === undefined ? current.watchPath || defaultWatchPath(nextOwnerUsername, current.project) : cleanText(input.watchPath),
        input.notes === undefined ? current.notes : cleanText(input.notes),
      ],
    );
    return (await hydrateProjects(result.rows, actor))[0]!;
  } finally {
    await postgres.disconnect();
  }
}

export async function archiveProject(projectId: string, actor: AuthUser): Promise<ProjectRecord> {
  return updateProject(projectId, { lifecycle: 'archived' }, actor);
}

export async function addProjectUpdate(projectId: string, input: AddProjectUpdateInput, actor: AuthUser): Promise<ProjectRecord> {
  const project = await getProjectForUser(projectId, actor);
  if (!project.access.canAddUpdate) {
    throw new Error('You do not have permission to add project updates.');
  }
  const text = cleanText(input.text);
  if (!text) throw new Error('Update text is required.');
  const updateType = input.type || 'progress';
  if (!isProjectUpdateType(updateType)) throw new Error('Unsupported update type.');

  const postgres = createPostgresClient('vioscope-projects');
  try {
    await postgres.pool.query('BEGIN');
    const updateResult = await postgres.pool.query<{ id: string }>(
      `
        INSERT INTO project_updates (project_id, update_date, by_username, update_type, text)
        VALUES ($1, COALESCE($2::date, CURRENT_DATE), $3, $4, $5)
        RETURNING id::text
      `,
      [project.id, cleanDate(input.date), actor.username, updateType, text],
    );
    const updateId = updateResult.rows[0]?.id;
    const artifactIds: string[] = [];

    const artifact = input.artifact;
    if (artifact && (cleanText(artifact.title) || cleanText(artifact.path))) {
      const title = cleanText(artifact.title) || cleanText(artifact.path)?.split('/').pop() || 'Artifact';
      const artifactKey = cleanText(artifact.artifactKey) || cleanText(artifact.path) || title;
      await postgres.pool.query(
        'UPDATE project_artifacts SET is_current = false WHERE project_id = $1 AND artifact_key = $2 AND deleted_at IS NULL',
        [project.id, artifactKey],
      );
      const artifactResult = await postgres.pool.query<{ id: string }>(
        `
          INSERT INTO project_artifacts (
            project_id, title, kind, path, summary, artifact_key, is_current, source_update_id, uploaded_by_username
          )
          VALUES ($1, $2, $3, $4, $5, $6, true, $7, $8)
          RETURNING id::text
        `,
        [
          project.id,
          title,
          cleanText(artifact.kind) || 'other',
          cleanText(artifact.path),
          cleanText(artifact.summary) || '',
          artifactKey,
          updateId,
          actor.username,
        ],
      );
      artifactIds.push(artifactResult.rows[0]!.id);
    }

    if (artifactIds.length) {
      await postgres.pool.query('UPDATE project_updates SET artifact_ids = $2::uuid[] WHERE id = $1', [updateId, artifactIds]);
    }
    await postgres.pool.query(
      'UPDATE project_records SET last_update = COALESCE($2::date, CURRENT_DATE), updated_at = now() WHERE id = $1',
      [project.id, cleanDate(input.date)],
    );
    await postgres.pool.query('COMMIT');
    return getProjectForUser(project.id, actor);
  } catch (error) {
    await postgres.pool.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await postgres.disconnect();
  }
}

export async function addProjectUpdateComment(updateId: string, textValue: string, actor: AuthUser): Promise<ProjectRecord> {
  await ensureProjectTables();
  const text = cleanText(textValue);
  if (!text) throw new Error('Comment text is required.');

  const postgres = createPostgresClient('vioscope-projects');
  try {
    const projectResult = await postgres.pool.query<{ project_id: string }>(
      'SELECT project_id::text FROM project_updates WHERE id = $1',
      [updateId],
    );
    const projectId = projectResult.rows[0]?.project_id;
    if (!projectId) throw new Error('Project update not found.');

    const project = await getProjectForUser(projectId, actor);
    if (!project.access.canComment) {
      throw new Error('You do not have permission to comment on this project update.');
    }

    await postgres.pool.query(
      `
        INSERT INTO project_update_comments (update_id, by_username, text)
        VALUES ($1, $2, $3)
      `,
      [updateId, actor.username, text],
    );
    return getProjectForUser(projectId, actor);
  } finally {
    await postgres.disconnect();
  }
}

export async function getProjectArtifactForUser(
  artifactId: string,
  actor: AuthUser,
): Promise<{ project: ProjectRecord; artifact: ProjectArtifactRecord }> {
  await ensureProjectTables();
  const postgres = createPostgresClient('vioscope-projects');

  try {
    const result = await postgres.pool.query<{ project_id: string }>(
      'SELECT project_id::text FROM project_artifacts WHERE id = $1 AND deleted_at IS NULL',
      [artifactId],
    );
    const projectId = result.rows[0]?.project_id;
    if (!projectId) throw new Error('Artifact not found.');

    const project = await getProjectForUser(projectId, actor);
    const artifact = project.artifacts.find((item) => item.id === artifactId);
    if (!artifact) throw new Error('Artifact not found or access denied.');
    return { project, artifact };
  } finally {
    await postgres.disconnect();
  }
}

export async function updateProjectArtifactDigest(
  artifactId: string,
  summary: string,
  kind: string,
  actor: AuthUser,
): Promise<ProjectRecord> {
  const { project } = await getProjectArtifactForUser(artifactId, actor);
  if (!project.access.canEdit) {
    throw new Error('You do not have permission to update this artifact.');
  }

  const postgres = createPostgresClient('vioscope-projects');
  try {
    await postgres.pool.query(
      `
        UPDATE project_artifacts
        SET summary = $2, kind = $3
        WHERE id = $1 AND deleted_at IS NULL
      `,
      [artifactId, cleanText(summary) || '', cleanText(kind) || 'other'],
    );
    await postgres.pool.query('UPDATE project_records SET updated_at = now() WHERE id = $1', [project.id]);
    return getProjectForUser(project.id, actor);
  } finally {
    await postgres.disconnect();
  }
}

export async function removeProjectArtifact(artifactId: string, actor: AuthUser): Promise<ProjectRecord> {
  const { project } = await getProjectArtifactForUser(artifactId, actor);
  if (!project.access.canEdit) {
    throw new Error('You do not have permission to remove this artifact.');
  }

  const postgres = createPostgresClient('vioscope-projects');
  try {
    await postgres.pool.query(
      `
        UPDATE project_artifacts
        SET deleted_at = now(), is_current = false
        WHERE id = $1 AND deleted_at IS NULL
      `,
      [artifactId],
    );
    await postgres.pool.query('UPDATE project_records SET updated_at = now() WHERE id = $1', [project.id]);
    return getProjectForUser(project.id, actor);
  } finally {
    await postgres.disconnect();
  }
}
