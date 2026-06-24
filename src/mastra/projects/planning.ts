import { listProjectsForUser, type ProjectRecord, type ProjectRecommendation } from '../db/projects';
import type { AuthUser } from '../db/users';

export type ProjectPlanningItem = {
  id: string;
  title: string;
  project: string;
  ownerUsername: string;
  stage: number;
  stageProgress: number;
  status: ProjectRecord['status'];
  target: string | null;
  blocker: string | null;
  lastUpdate: string | null;
  recommendation: ProjectRecommendation;
  attentionReason: string | null;
  progressText: string | null;
  updatedAt: string | null;
};

export type ProjectPlanningReport = {
  generatedAt: string;
  cycleStart: string;
  cycleDays: number;
  projectCount: number;
  activeProjectCount: number;
  attentionItems: ProjectPlanningItem[];
  updatedProjects: ProjectPlanningItem[];
  markdown: string;
};

const recommendationRank: Record<ProjectRecommendation, number> = {
  deep_dive: 0,
  milestone_check: 1,
  strategic_slot: 2,
  none: 3,
};

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function isOnOrAfter(value: string | null, threshold: string): boolean {
  return Boolean(value && value >= threshold);
}

function latestProgress(project: ProjectRecord) {
  return project.updates.find((update) => update.type === 'progress') || null;
}

function toPlanningItem(project: ProjectRecord): ProjectPlanningItem {
  const progress = latestProgress(project);
  return {
    id: project.id,
    title: project.title,
    project: project.project,
    ownerUsername: project.ownerUsername,
    stage: project.stage,
    stageProgress: project.stageProgress,
    status: project.status,
    target: project.target,
    blocker: project.blocker,
    lastUpdate: project.lastUpdate,
    recommendation: project.recommendation,
    attentionReason: project.attentionReason,
    progressText: progress?.text || null,
    updatedAt: progress?.date || project.lastUpdate,
  };
}

function sortPlanningItems(left: ProjectPlanningItem, right: ProjectPlanningItem): number {
  return (
    recommendationRank[left.recommendation] - recommendationRank[right.recommendation] ||
    Number(Boolean(right.blocker)) - Number(Boolean(left.blocker)) ||
    right.stageProgress - left.stageProgress ||
    left.title.localeCompare(right.title)
  );
}

function lineForItem(item: ProjectPlanningItem): string {
  const progress = item.progressText ? ` Progress: ${item.progressText}` : '';
  const reason = item.attentionReason ? ` Reason: ${item.attentionReason}.` : '';
  const blocker = item.blocker ? ` Blocker: ${item.blocker}.` : '';
  return `- ${item.title} (${item.ownerUsername}): ${item.recommendation}, stage ${item.stage} (${item.stageProgress}%), ${item.status}.${reason}${blocker}${progress}`;
}

export function renderProjectPlanningBrief(report: Omit<ProjectPlanningReport, 'markdown'>): string {
  const attention = report.attentionItems.length ? report.attentionItems.map(lineForItem).join('\n') : '- None';
  const updated = report.updatedProjects.length ? report.updatedProjects.map(lineForItem).join('\n') : '- None';

  return `# Project Planning Brief

- Generated: ${report.generatedAt}
- Cycle start: ${report.cycleStart}
- Active projects: ${report.activeProjectCount}/${report.projectCount}

## Attention Items
${attention}

## Updated Projects
${updated}
`;
}

export async function buildProjectPlanningReport(
  user: AuthUser,
  input: { now?: Date; cycleDays?: number } = {},
): Promise<ProjectPlanningReport> {
  const now = input.now || new Date();
  const cycleDays = input.cycleDays || 14;
  const cycleStart = dateOnly(addDays(now, -cycleDays));
  const projects = await listProjectsForUser(user, { includeArchived: false });
  const activeProjects = projects.filter((project) => project.lifecycle === 'active');
  const attentionItems = activeProjects
    .filter((project) => project.needsUpdate || project.recommendation !== 'none' || project.status !== 'on_track' || Boolean(project.blocker))
    .map(toPlanningItem)
    .sort(sortPlanningItems);
  const updatedProjects = activeProjects
    .filter((project) => isOnOrAfter(project.lastUpdate, cycleStart))
    .map(toPlanningItem)
    .sort((left, right) => (right.updatedAt || '').localeCompare(left.updatedAt || '') || left.title.localeCompare(right.title));
  const reportWithoutMarkdown = {
    generatedAt: now.toISOString(),
    cycleStart,
    cycleDays,
    projectCount: projects.length,
    activeProjectCount: activeProjects.length,
    attentionItems,
    updatedProjects,
  };

  return {
    ...reportWithoutMarkdown,
    markdown: renderProjectPlanningBrief(reportWithoutMarkdown),
  };
}
