import { z } from 'zod';
import { ideaFields, type IdeaDraft } from './idea-check';
const fieldKey = z.enum(['question', 'importance', 'contribution', 'evidence', 'validation', 'resources', 'risks', 'milestone']);
const text = z.string().trim().min(1).max(4000);
export const ideaReviewSchema = z.object({
  recommendation: z.enum(['ready_for_discussion', 'needs_revision', 'insufficient_evidence']),
  summary: text,
  checks: z.array(z.object({ field: fieldKey, status: z.enum(['supported', 'needs_work', 'missing']),
    assessment: text, evidence: z.array(z.object({ field: fieldKey, quote: z.string().trim().min(1).max(1000) }).strict()).max(4),
    improvement: text }).strict()).length(8),
  nextSteps: z.array(text).min(1).max(5),
}).strict();
export type IdeaReview = z.infer<typeof ideaReviewSchema>;
export type SavedIdeaReview = { id: string; pitchVersion: number; report: IdeaReview; rulesHash: string; model: string; by: string; at: string };
export function validateIdeaReview(value: unknown, draft: IdeaDraft): IdeaReview {
  const report = ideaReviewSchema.parse(value);
  const advice = [report.summary, ...report.checks.flatMap(check => [check.assessment, check.improvement]), ...report.nextSteps];
  if (advice.some(text => /\p{Script=Han}/u.test(text))) throw new Error('AI advice must be in English. Please try again. Original evidence quotations may remain in their source language.');
  if (new Set(report.checks.map((item) => item.field)).size !== ideaFields.length) throw new Error('The review must cover every criterion once.');
  for (const check of report.checks) {
    for (const evidence of check.evidence) if (!draft[evidence.field].includes(evidence.quote)) throw new Error('The review cited text not present in this pitch.');
    if (check.status === 'supported' && !check.evidence.length) throw new Error('Supported findings require pitch evidence.');
    if (!draft[check.field].trim() && check.status !== 'missing') throw new Error('Empty pitch sections must be marked missing.');
  }
  if (report.recommendation === 'ready_for_discussion' && report.checks.some((item) => item.status === 'missing')) throw new Error('An incomplete pitch cannot be marked ready for discussion.');
  return report;
}
