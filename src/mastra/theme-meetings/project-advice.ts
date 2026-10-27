import type { ProjectRecord } from '../db/projects';
import type { ThemeUpdateType } from './schema';

type AdviceProject = Pick<ProjectRecord,
  'lifecycle' | 'status' | 'blocker' | 'stage' | 'stageProgress' | 'lastUpdate' | 'submissionDeadline' | 'updates'
>;

export function suggestThemeMeetingSlot(project: AdviceProject, now = new Date()): {
  slot: Exclude<ThemeUpdateType, 'nothing_to_report'> | null;
  evidence: string;
  preparation: string;
} | null {
  if (project.lifecycle !== 'active') return null;
  const latestProgress = project.updates.find((update) => update.type === 'progress');
  const progressDate = latestProgress?.date || project.lastUpdate;
  const age = progressDate ? (now.getTime() - Date.parse(progressDate)) / 86_400_000 : NaN;
  const fresh = age >= 0 && age < 14;
  const deadlineDays = project.submissionDeadline
    ? (Date.parse(project.submissionDeadline) - Date.parse(now.toISOString().slice(0, 10))) / 86_400_000
    : NaN;
  const freshness = fresh ? '' : ' Refresh the project update; the recorded progress is missing or out of date.';

  if (project.blocker?.trim() || project.status === 'blocked') {
    return {
      slot: 'deep_dive',
      evidence: (project.blocker?.trim() ? `Recorded blocker: ${project.blocker.trim()}.` : 'The project is marked blocked.') + freshness,
      preparation: 'Bring the problem, evidence, what you tried, and one question the group can help resolve.',
    };
  }
  if (project.status === 'needs_input') {
    return {
      slot: 'strategic_slot',
      evidence: 'The project is marked as needing input.' + freshness,
      preparation: 'State the decision you need, the alternatives, and the feedback or help you want.',
    };
  }
  const milestone = fresh && Boolean(latestProgress?.milestone);
  const deadlineSoon = deadlineDays >= 0 && deadlineDays <= 30;
  if (milestone || deadlineSoon || (fresh && project.stageProgress >= 80)) {
    return {
      slot: 'milestone_check',
      evidence: [
        milestone ? `The progress update on ${progressDate} records a milestone.` : '',
        deadlineSoon ? `Submission deadline: ${project.submissionDeadline} (${deadlineDays} days away).` : '',
        fresh && project.stageProgress >= 80 ? `Stage ${project.stage} is ${project.stageProgress}% complete.` : '',
      ].filter(Boolean).join(' ') + freshness,
      preparation: 'Show what is complete, the remaining work, and the next checkpoint or submission risk.',
    };
  }
  if (!fresh) {
    return {
      slot: null,
      evidence: progressDate ? `The last recorded progress is dated ${progressDate}; it is not current enough to suggest a slot.` : 'No project progress has been recorded.',
      preparation: 'Update your project progress first, then choose the slot. Missing data does not mean nothing to report.',
    };
  }
  if (project.stage === 1) {
    return {
      slot: 'strategic_slot',
      evidence: `The project is at the idea/proposal stage, with progress recorded on ${progressDate}.`,
      preparation: 'Bring the research question or idea, possible directions, and the feedback you need.',
    };
  }
  return {
    slot: 'short_update',
    evidence: `Progress was recorded on ${progressDate}, with no recorded blocker, near deadline, or milestone flag.`,
    preparation: 'Summarize what changed, one result, and the next step. Choose a deep dive if you have a substantial result to discuss.',
  };
}
