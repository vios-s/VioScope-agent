import { z } from 'zod';
import type { ProjectRecord } from '../db/projects';
import type { SubmissionReviewResult } from './review';

const noteField = z.string().trim().min(1, 'Enter the reason, evidence and required actions.').max(4000, 'Keep the note within 4,000 characters.');
const confirmedField = z.literal(true, { error: 'Confirm that this is your human judgment before recording it.' });
export const skeletonDecisionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('pdra'), outcome: z.enum(['locked', 'conditional', 'revise']), note: noteField, revision: z.number().int().nonnegative(), confirmed: confirmedField, override: z.literal(true).optional() }).strict(),
  z.object({ kind: z.literal('pi'), outcome: z.enum(['approved', 'needs_revision']), note: noteField, revision: z.number().int().nonnegative(), confirmed: confirmedField, override: z.literal(true).optional() }).strict(),
]);
export type SkeletonDecision = { kind: 'pdra' | 'pi'; outcome: string; note: string; by: string; at: string; override?: true };
/** Readable labels for the stored PDRA/PI outcome codes and AI verdicts. */
export const skeletonOutcomeLabels: Record<string, string> = { revise: 'Revise before locking', conditional: 'Conditional — actions required', locked: 'Ready to lock', needs_revision: 'Returned for revision', approved: 'PI confirmed' };
export const skeletonVerdictLabels: Record<string, string> = { CLEARED: 'Cleared', CONDITIONAL: 'Conditional', SLIDE: 'Slide to a later deadline' };
export function skeletonProjectSnapshot(project: ProjectRecord) {
  return { id: project.id, title: project.title, ownerUsername: project.ownerUsername, piUsername: project.piUsername,
    pdraUsername: project.pdraUsername, collaborators: project.collaborators, venue: project.venue,
    submissionDeadline: project.submissionDeadline, target: project.target };
}
export type SkeletonProjectSnapshot = ReturnType<typeof skeletonProjectSnapshot>;
export type SkeletonRecord = {
  id: string; projectId: string; createdAt: string; createdBy: string; revision: number;
  projectSnapshot: SkeletonProjectSnapshot; draftText: string; result: SubmissionReviewResult; decisions: SkeletonDecision[];
};
export function latestSkeletonDecisions(decisions: SkeletonDecision[]) {
  const pdraIndex = decisions.findLastIndex(item => item.kind === 'pdra');
  return { pdra: decisions[pdraIndex] || null, pi: decisions.slice(pdraIndex + 1).findLast(item => item.kind === 'pi') || null };
}
