import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import type { AuthUser } from '../db/users';
import { getProjectForUser, listProjectsForUser, type ProjectRecord } from '../db/projects';
import { buildProjectPlanningReport } from '../projects/planning';

const projectLifecycleSchema = z.enum(['active', 'paused', 'finished', 'archived']);
const projectStatusSchema = z.enum(['on_track', 'blocked', 'stale', 'needs_input']);
const projectRecommendationSchema = z.enum(['deep_dive', 'milestone_check', 'strategic_slot', 'none']);

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
  stage: z.number().nullable(),
  stageProgress: z.number().nullable(),
  status: projectStatusSchema.nullable(),
  blocker: z.string().nullable(),
  target: z.string().nullable(),
  milestone: z.boolean(),
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
  stageProgress: z.number(),
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
  needsUpdate: z.boolean(),
  overdue: z.boolean(),
  attentionReason: z.string().nullable(),
  recommendation: projectRecommendationSchema,
  accessReason: z.enum(['owner', 'coordinator', 'pi_admin']),
});

const planningItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  project: z.string(),
  ownerUsername: z.string(),
  stage: z.number(),
  stageProgress: z.number(),
  status: projectStatusSchema,
  target: z.string().nullable(),
  blocker: z.string().nullable(),
  lastUpdate: z.string().nullable(),
  recommendation: projectRecommendationSchema,
  attentionReason: z.string().nullable(),
  progressText: z.string().nullable(),
  updatedAt: z.string().nullable(),
});

const projectPlanningReportSchema = z.object({
  generatedAt: z.string(),
  cycleStart: z.string(),
  cycleDays: z.number(),
  projectCount: z.number(),
  activeProjectCount: z.number(),
  attentionItems: z.array(planningItemSchema),
  updatedProjects: z.array(planningItemSchema),
  markdown: z.string(),
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
    stageProgress: project.stageProgress,
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
      stage: update.stage,
      stageProgress: update.stageProgress,
      status: update.status,
      blocker: update.blocker,
      target: update.target,
      milestone: update.milestone,
      artifactIds: update.artifactIds,
      commentCount: update.comments.length,
      createdAt: update.createdAt,
    })),
    needsUpdate: project.needsUpdate,
    overdue: project.overdue,
    attentionReason: project.attentionReason,
    recommendation: project.recommendation,
    accessReason: project.access.reason,
  };
}

function renderProjectList(projects: ReturnType<typeof toProjectContext>[]): string {
  if (!projects.length) return 'No visible projects found.';

  function field(label: string, value: string | null) {
    if (!value) return '';
    const text = value.trim();
    return ` ${label}: ${text}${/[.!?]$/.test(text) ? '' : '.'}`;
  }

  return projects
    .map((project) => {
      const target = project.target ? ` Target: ${project.target}` : '';
      const deadline = project.submissionDeadline ? ` Deadline: ${project.submissionDeadline}.` : '';
      const artifacts = project.currentArtifacts.length
        ? ` Current artifacts: ${project.currentArtifacts.map((artifact) => `${artifact.title}${artifact.summary ? ` (${artifact.summary})` : ''}`).join('; ')}.`
        : '';
      const progress = `stage ${project.stage} (${project.stageProgress}%)`;
      const blocker = field('Blocker', project.blocker);
      const attention = project.attentionReason ? ` Attention: ${project.attentionReason}.` : '';
      return `- ${project.title} (${project.project}): owner ${project.ownerUsername}, track ${project.track}, ${progress}, ${project.lifecycle}/${project.status}, recommended ${project.recommendation}.${deadline}${target}${blocker}${attention}${artifacts}`;
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
          .map((update) => {
            const stage = update.stage ? ` stage ${update.stage}${update.stageProgress !== null ? ` (${update.stageProgress}%)` : ''}` : '';
            const status = update.status ? ` ${update.status}` : '';
            const milestone = update.milestone ? ' milestone' : '';
            const target = update.target ? `\n  Target: ${update.target}` : '';
            const blocker = update.blocker ? `\n  Blocker: ${update.blocker}` : '';
            return `- ${update.date} ${update.type}${milestone}${stage}${status} by ${update.byUsername}: ${update.text}${target}${blocker}`;
          })
          .join('\n')
      : 'No timeline updates recorded.';
    return {
      type: 'text',
      value: `${renderProjectList([project])}\n\nRecent updates:\n${updates}`,
    };
  },
});

export const checkProjectProgressTool = createTool({
  id: 'check-project-progress',
  description:
    'Build a project planning report for projects visible to the signed-in user. Use it to answer which projects need attention, which were updated this cycle, and what theme-meeting slots are recommended.',
  inputSchema: z.object({}),
  outputSchema: z.object({
    report: projectPlanningReportSchema,
  }),
  mcp: {
    annotations: {
      title: 'Check Project Progress',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  execute: async (_input, context) => {
    const user = requestUser(context);
    return {
      report: await buildProjectPlanningReport(user),
    };
  },
  toModelOutput: (output) => ({
    type: 'text',
    value: output.report.markdown,
  }),
});
