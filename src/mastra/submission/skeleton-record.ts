import {projectPIs,projectPDRAs} from '../projects/review-team';
import { z } from 'zod';
import type { ProjectRecord } from '../db/projects';
import type { SubmissionReviewResult } from './review';

const noteField = z.string().trim().min(1, 'Enter the reason, evidence and required actions.').max(4000, 'Keep the note within 4,000 characters.');
const confirmedField = z.literal(true, { error: 'Confirm that this is your human judgment before recording it.' });
/** Today's calendar date in Europe/London as YYYY-MM-DD. */
export function londonToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
function isCalendarDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
// New PDRA judgments use the VIOS OS Skeleton Lock verdicts. Stored legacy codes (locked/conditional/revise) stay readable only.
export const skeletonDecisionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('pdra'), outcome: z.enum(['CLEARED', 'CONDITIONAL', 'SLIDE'], { error: 'Choose CLEARED, CONDITIONAL or SLIDE.' }), reevaluateOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter the re-evaluation date as YYYY-MM-DD.').optional(), note: noteField, revision: z.number().int().nonnegative(), confirmed: confirmedField, override: z.literal(true).optional() }).strict(),
  z.object({ kind: z.literal('pi'), outcome: z.enum(['approved', 'needs_revision']), note: noteField, revision: z.number().int().nonnegative(), confirmed: confirmedField, override: z.literal(true).optional() }).strict(),
]).superRefine((value, context) => {
  if (value.kind !== 'pdra') return;
  if (value.outcome !== 'CONDITIONAL') {
    if (value.reevaluateOn) context.addIssue({ code: 'custom', path: ['reevaluateOn'], message: 'A re-evaluation date applies only to a CONDITIONAL verdict.' });
    return;
  }
  if (!value.reevaluateOn) context.addIssue({ code: 'custom', path: ['reevaluateOn'], message: 'A CONDITIONAL verdict needs a re-evaluation date after the 72-hour sprint.' });
  else if (!isCalendarDate(value.reevaluateOn) || value.reevaluateOn <= londonToday()) context.addIssue({ code: 'custom', path: ['reevaluateOn'], message: 'Choose a valid re-evaluation date after today (Europe/London).' });
});
export type SkeletonDecision = { kind: 'pdra' | 'pi'; outcome: string; note: string; by: string; at: string; override?: true; reevaluateOn?: string };
/** One vocabulary for the AI suggestion and the PDRA judgment (VIOS OS Skeleton Lock verdict table). */
export const skeletonVerdictLabels: Record<string, string> = { CLEARED: 'Cleared — ready to lock', CONDITIONAL: 'Conditional — actions required', SLIDE: 'Slide to the next submission cycle' };
/** Readable labels for stored PDRA/PI outcome codes, including legacy PDRA codes recorded before the verdict change. */
export const skeletonOutcomeLabels: Record<string, string> = { ...skeletonVerdictLabels, revise: 'Revise before locking', conditional: 'Conditional — actions required', locked: 'Ready to lock', needs_revision: 'Returned for revision', approved: 'PI confirmed' };
export const legacySkeletonOutcomes = new Set(['locked', 'conditional', 'revise']);
/** New checks open only at project stage 4 (Pre-Submission); existing reviews stay readable and completable. */
export function assertSkeletonStage(project: Pick<ProjectRecord, 'stage'>) {
  if (project.stage !== 4) throw new Error(`Skeleton Lock opens at stage 4 (Pre-Submission). This project is currently at stage ${project.stage}; update the stage in Projects when it is ready.`);
}
export function skeletonProjectSnapshot(project: ProjectRecord) {
  return { id: project.id, title: project.title, ownerUsername: project.ownerUsername, piUsername: project.piUsername,
    ...(projectPIs(project).length>1?{piUsernames:[...projectPIs(project)].sort()}:{}),
    ...(projectPDRAs(project).length>1?{pdraUsernames:[...projectPDRAs(project)].sort()}:{}),
    pdraUsername: project.pdraUsername, collaborators: project.collaborators, venue: project.venue,
    submissionDeadline: project.submissionDeadline, target: project.target };
}
export type SkeletonProjectSnapshot = ReturnType<typeof skeletonProjectSnapshot>;
export type SkeletonRecord = {
  id: string; projectId: string; createdAt: string; createdBy: string; revision: number;
  projectSnapshot: SkeletonProjectSnapshot; draftText: string; result: SubmissionReviewResult; decisions: SkeletonDecision[];
};
/** The current PDRA judgment and the PI confirmation that still applies to it. Re-recording the same verdict (and, for
 * CONDITIONAL, the same re-evaluation date) keeps an existing PI confirmation; a changed verdict needs a fresh one. */
export function latestSkeletonDecisions(decisions: SkeletonDecision[]) {
  const pdraIndex = decisions.findLastIndex(item => item.kind === 'pdra');
  const pdra = decisions[pdraIndex] || null;
  let since = pdraIndex;
  for (let index = pdraIndex - 1; pdra && index >= 0; index--) {
    const item = decisions[index];
    if (item.kind !== 'pdra') continue;
    if (item.outcome !== pdra.outcome || item.reevaluateOn !== pdra.reevaluateOn) break;
    since = index;
  }
  return { pdra, pi: decisions.slice(since + 1).findLast(item => item.kind === 'pi') || null };
}
