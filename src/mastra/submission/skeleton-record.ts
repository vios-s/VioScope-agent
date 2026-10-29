import { z } from 'zod';
import type { ProjectRecord } from '../db/projects';
import type { SubmissionReviewResult } from './review';

export const skeletonDecisionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('pdra'), outcome: z.enum(['locked', 'conditional', 'revise']), note: z.string().trim().min(1).max(4000), revision: z.number().int().nonnegative(), confirmed: z.literal(true) }).strict(),
  z.object({ kind: z.literal('pi'), outcome: z.enum(['approved', 'needs_revision']), note: z.string().trim().min(1).max(4000), revision: z.number().int().nonnegative(), confirmed: z.literal(true) }).strict(),
]);
export type SkeletonDecision = { kind: 'pdra' | 'pi'; outcome: string; note: string; by: string; at: string };
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
