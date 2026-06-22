import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import type { AuthUser } from '../db/users';
import { getProjectForUser, listProjectsForUser, type ProjectRecord } from '../db/projects';

const projectLifecycleSchema = z.enum(['active', 'paused', 'finished', 'archived']);
const projectStatusSchema = z.enum(['on_track', 'blocked', 'stale', 'needs_input']);

const artifactSchema = z.object({
  id: z.string(),
  title: z.string(),
  kind: z.string(),
  path: z.string().nullable(),
  summary: z.string(),
  artifactKey: z.string(),
  isCurrent: z.boolean(),
  createdAt: z.string(),
});

const updateSchema = z.object({
  id: z.string(),
  date: z.string(),
  byUsername: z.string(),
  type: z.enum(['progress', 'note', 'decision', 'blocker', 'artifact']),
  text: z.string(),
  artifactIds: z.array(z.string()),
  commentCount: z.number(),
  createdAt: z.string(),
});

const projectContextSchema = z.object({
  id: z.string(),
  project: z.string(),
  title: z.string(),
  ownerUsername: z.string(),
  collaborators: z.array(z.string()),
  track: z.string(),
  stage: z.number(),
  lifecycle: projectLifecycleSchema,
  status: projectStatusSchema,
  stageSince: z.string().nullable(),
  lastUpdate: z.string().nullable(),
  blocker: z.string().nullable(),
  target: z.string().nullable(),
  venue: z.string().nullable(),
  submissionDeadline: z.string().nullable(),
  watchPath: z.string().nullable(),
  notes: z.string().nullable(),
  currentArtifacts: z.array(artifactSchema),
  recentUpdates: z.array(updateSchema),
  accessReason: z.enum(['owner', 'collaborator', 'coordinator', 'pi_admin']),
});

function requestUser(context: { requestContext?: { get: (key: string) => unknown } } | undefined): AuthUser {
  const user = context?.requestContext?.get('vioscope-user') as AuthUser | undefined;
  if (!user?.id || !user.username) {
    throw new Error('Project tools require a signed-in VioScope user context.');
  }
  return user;
}

function toProjectContext(project: ProjectRecord, input: { maxUpdates?: number; includeOldArtifacts?: boolean } = {}) {
  const maxUpdates = Math.max(1, Math.min(input.maxUpdates || 5, 50));
  const artifacts = input.includeOldArtifacts ? project.artifacts : project.artifacts.filter((artifact) => artifact.isCurrent);

  return {
    id: project.id,
    project: project.project,
    title: project.title,
    ownerUsername: project.ownerUsername,
    collaborators: project.collaborators,
    track: project.track,
    stage: project.stage,
    lifecycle: project.lifecycle,
    status: project.status,
    stageSince: project.stageSince,
    lastUpdate: project.lastUpdate,
    blocker: project.blocker,
    target: project.target,
    venue: project.venue,
    submissionDeadline: project.submissionDeadline,
    watchPath: project.watchPath,
    notes: project.notes,
    currentArtifacts: artifacts.map((artifact) => ({
      id: artifact.id,
      title: artifact.title,
      kind: artifact.kind,
      path: artifact.path,
      summary: artifact.summary,
      artifactKey: artifact.artifactKey,
      isCurrent: artifact.isCurrent,
      createdAt: artifact.createdAt,
    })),
    recentUpdates: project.updates.slice(0, maxUpdates).map((update) => ({
      id: update.id,
      date: update.date,
      byUsername: update.byUsername,
      type: update.type,
      text: update.text,
      artifactIds: update.artifactIds,
      commentCount: update.comments.length,
      createdAt: update.createdAt,
    })),
    accessReason: project.access.reason,
  };
}

function renderProjectList(projects: ReturnType<typeof toProjectContext>[]): string {
  if (!projects.length) return 'No visible projects found.';
  return projects
    .map((project) => {
      const target = project.target ? ` Target: ${project.target}` : '';
      const deadline = project.submissionDeadline ? ` Deadline: ${project.submissionDeadline}.` : '';
      const artifacts = project.currentArtifacts.length
        ? ` Current artifacts: ${project.currentArtifacts.map((artifact) => `${artifact.title}${artifact.summary ? ` (${artifact.summary})` : ''}`).join('; ')}.`
        : '';
      return `- ${project.title} (${project.project}): owner ${project.ownerUsername}, track ${project.track}, stage ${project.stage}, ${project.lifecycle}/${project.status}.${deadline}${target}${artifacts}`;
    })
    .join('\n');
}

export const listVisibleProjectsTool = createTool({
  id: 'list-visible-projects',
  description:
    'List projects visible to the signed-in user. Use this for lab project status, ownership, collaborator, deadline, blocker, target, and artifact-summary questions before answering.',
  inputSchema: z.object({
    includeArchived: z.boolean().optional(),
    lifecycle: projectLifecycleSchema.optional(),
    status: projectStatusSchema.optional(),
    ownerUsername: z.string().trim().min(1).optional(),
  }),
  outputSchema: z.object({
    projects: z.array(projectContextSchema),
  }),
  mcp: {
    annotations: {
      title: 'List Visible Projects',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  execute: async (input, context) => {
    const user = requestUser(context);
    const projects = await listProjectsForUser(user, { includeArchived: input.includeArchived });
    const filtered = projects.filter((project) => {
      if (input.lifecycle && project.lifecycle !== input.lifecycle) return false;
      if (input.status && project.status !== input.status) return false;
      if (input.ownerUsername && project.ownerUsername.toLowerCase() !== input.ownerUsername.toLowerCase()) return false;
      return true;
    });
    return {
      projects: filtered.map((project) => toProjectContext(project)),
    };
  },
  toModelOutput: (output) => ({
    type: 'text',
    value: renderProjectList(output.projects),
  }),
});

export const getProjectDetailTool = createTool({
  id: 'get-project-detail',
  description:
    'Read one visible project in detail. Returns timeline updates and current artifact summaries, not full file bodies.',
  inputSchema: z.object({
    projectId: z.string().trim().min(1).describe('Project id, slug, or full project name.'),
    maxUpdates: z.number().int().min(1).max(50).optional(),
    includeOldArtifacts: z.boolean().optional(),
  }),
  outputSchema: z.object({
    project: projectContextSchema,
  }),
  mcp: {
    annotations: {
      title: 'Get Project Detail',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  execute: async (input, context) => {
    const user = requestUser(context);
    const project = await getProjectForUser(input.projectId, user);
    return {
      project: toProjectContext(project, {
        maxUpdates: input.maxUpdates || 10,
        includeOldArtifacts: input.includeOldArtifacts,
      }),
    };
  },
  toModelOutput: (output) => {
    const project = output.project;
    const updates = project.recentUpdates.length
      ? project.recentUpdates
          .map((update) => `- ${update.date} ${update.type} by ${update.byUsername}: ${update.text}`)
          .join('\n')
      : 'No timeline updates recorded.';
    return {
      type: 'text',
      value: `${renderProjectList([project])}\n\nRecent updates:\n${updates}`,
    };
  },
});
