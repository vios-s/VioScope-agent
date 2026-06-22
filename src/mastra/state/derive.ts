import {
  derivedLabStateSchema,
  type DerivedLabState,
  type DerivedLabStateProject,
  type LabState,
  type LabStateProject,
  type LabStateSummary,
  type ProjectRecommendation,
  type ProjectStatus,
} from './schema';

export type DeriveLabStateOptions = {
  today?: Date;
  staleDays?: number;
  deepDiveWeeks?: number;
};

const defaultStaleDays = Number.parseInt(process.env.THEME_MEETING_STALE_DAYS || '14', 10);
const defaultDeepDiveWeeks = Number.parseInt(process.env.THEME_MEETING_DEEP_DIVE_WEEKS || '3', 10);

function parseDate(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function fullDaysBetween(start: Date, end: Date): number {
  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / millisecondsPerDay));
}

export function deriveProject(project: LabStateProject, options: DeriveLabStateOptions = {}): DerivedLabStateProject {
  const today = options.today || new Date();
  const staleDays = options.staleDays ?? defaultStaleDays;
  const deepDiveWeeks = options.deepDiveWeeks ?? defaultDeepDiveWeeks;
  const signals: DerivedLabStateProject['derived']['signals'] = [];

  const stageSince = parseDate(project.stage_since);
  const lastUpdate = parseDate(project.last_update);
  const weeksInStage = stageSince ? Math.floor(fullDaysBetween(stageSince, today) / 7) : null;
  const daysSinceUpdate = lastUpdate ? fullDaysBetween(lastUpdate, today) : null;

  if (!stageSince) signals.push('missing_stage_since');
  if (!lastUpdate) signals.push('missing_last_update');
  if (project.status === 'blocked') signals.push('blocked_status');
  if (project.status === 'needs_input') signals.push('needs_input_status');
  if (project.status === 'stale') signals.push('stale_status');
  if (project.blocker) signals.push('blocker_present');
  if (daysSinceUpdate !== null && daysSinceUpdate >= staleDays) signals.push('no_recent_update');
  if (weeksInStage !== null && weeksInStage >= deepDiveWeeks) signals.push('long_time_in_stage');

  let recommendation: ProjectRecommendation = 'none';
  if (
    signals.includes('blocked_status') ||
    signals.includes('blocker_present') ||
    signals.includes('long_time_in_stage')
  ) {
    recommendation = 'deep_dive';
  } else if (
    signals.includes('needs_input_status') ||
    signals.includes('stale_status') ||
    signals.includes('no_recent_update') ||
    signals.includes('missing_last_update')
  ) {
    recommendation = 'nudge';
  }

  return {
    ...project,
    derived: {
      weeks_in_stage: weeksInStage,
      days_since_update: daysSinceUpdate,
      recommendation,
      signals: [...new Set(signals)],
    },
  };
}

export function deriveLabState(state: LabState, options: DeriveLabStateOptions = {}): DerivedLabState {
  return derivedLabStateSchema.parse({
    ...state,
    projects: state.projects.map((project) => deriveProject(project, options)),
  });
}

export function summarizeLabState(state: DerivedLabState): LabStateSummary {
  const byStatus: Record<ProjectStatus, number> = {
    on_track: 0,
    blocked: 0,
    stale: 0,
    needs_input: 0,
  };
  const byRecommendation: Record<ProjectRecommendation, number> = {
    deep_dive: 0,
    nudge: 0,
    none: 0,
  };

  for (const project of state.projects) {
    byStatus[project.status] += 1;
    byRecommendation[project.derived.recommendation] += 1;
  }

  return {
    totalProjects: state.projects.length,
    byStatus,
    byRecommendation,
    projectsNeedingAttention: state.projects.filter((project) => project.derived.recommendation !== 'none'),
  };
}

export function renderThemeMeetingSummary(state: DerivedLabState, summary = summarizeLabState(state)): string {
  const attention = summary.projectsNeedingAttention
    .map((project) => {
      const weeks = project.derived.weeks_in_stage === null ? 'unknown' : `${project.derived.weeks_in_stage}w`;
      const updateAge =
        project.derived.days_since_update === null ? 'unknown' : `${project.derived.days_since_update}d`;
      return `- ${project.project} (${project.owner}): ${project.derived.recommendation}, stage ${project.stage}, in-stage ${weeks}, last update ${updateAge}, signals ${project.derived.signals.join(', ') || 'none'}`;
    })
    .join('\n');

  return `# Theme Meeting State Summary

Total projects: ${summary.totalProjects}

Status:
- on_track: ${summary.byStatus.on_track}
- blocked: ${summary.byStatus.blocked}
- stale: ${summary.byStatus.stale}
- needs_input: ${summary.byStatus.needs_input}

Recommendations:
- deep_dive: ${summary.byRecommendation.deep_dive}
- nudge: ${summary.byRecommendation.nudge}
- none: ${summary.byRecommendation.none}

Projects needing attention:
${attention || '- None'}
`;
}
