import { z } from 'zod';
import { ideaDraftSchema, type IdeaDraft } from './idea-check';

export const ideaReviewBlocks = ['why', 'context', 'strategy', 'execution', 'resourcePlan'] as const;
export const ideaTemplatePrompts = ['The Pain Point', 'Target Audience', 'The Wild Factor', 'The Giants', 'The Graveyard',
  'The Core Idea', 'Data & Compute', 'The Pipeline', 'The Kill Switch', 'The 2-Week Experiment', 'Evaluation', 'Timeline',
  'The dataset', 'The computation', 'The human labour'] as const;
export const ideaBlockStatusLabels = { missing: 'Missing', needs_work: 'Needs work', adequate: 'Adequate', strong: 'Strong' } as const;
export const ideaDiscussantStatusLabels = { addressed: 'Addressed', partial: 'Partly addressed', unanswered: 'Not addressed' } as const;
export const ideaDiscussantQuestions = { delta: 'Is the delta big enough for a top-tier venue?', poc: 'If the Week 1–2 PoC fails, do we kill it or pivot?' } as const;

const maxQuoteChars = 1000;
const text = z.string().trim().min(1).max(4000);
const evidence = z.array(z.object({ field: z.enum([...ideaReviewBlocks, 'track']), quote: z.string().trim().min(1).max(maxQuoteChars) }).strict()).max(4);
const discussant = z.object({ status: z.enum(['addressed', 'partial', 'unanswered']), answer: text, evidence }).strict();
// Review schema v2: one finding per VIOS template block. Older saved reports use LegacyIdeaReview.
export const ideaReviewSchema = z.object({
  summary: text,
  blocks: z.array(z.object({ block: z.enum(ideaReviewBlocks), status: z.enum(['missing', 'needs_work', 'adequate', 'strong']),
    focus: z.array(z.enum(ideaTemplatePrompts)).max(4), gap: text, improvement: text, evidence }).strict()).length(ideaReviewBlocks.length),
  discussant: z.object({ delta: discussant, poc: discussant }).strict(),
  nextSteps: z.array(text).min(1).max(3),
}).strict();
export type IdeaReview = z.infer<typeof ideaReviewSchema>;
/** Eight-criteria report saved before the per-block schema; read-only. */
export type LegacyIdeaReview = { recommendation: string; summary: string; nextSteps: string[];
  checks: Array<{ field: string; status: string; assessment: string; improvement: string; evidence: Array<{ field: string; quote: string }> }> };
export type SavedIdeaReview = { id: string; pitchVersion: number; report: IdeaReview | LegacyIdeaReview; rulesHash: string; model: string; by: string; at: string };
export const isLegacyIdeaReview = (report: IdeaReview | LegacyIdeaReview): report is LegacyIdeaReview => 'checks' in report;

type Quote = { field: (typeof ideaReviewBlocks)[number] | 'track'; quote: string };
/** Map a model quotation to the exact pitch text it reproduces. Models sometimes recapitalise a clause, add a full stop,
 *  reflow spaces or name the neighbouring block; the saved quote is always the verbatim pitch substring, or null. */
function locateQuote(item: Quote, draft: IdeaDraft): Quote | null {
  if (draft[item.field].includes(item.quote)) return item;
  const words = item.quote.trim().replace(/[.,;:!?]+$/, '').split(/\s+/).filter(Boolean);
  if (words.length < 3) return null;
  const pattern = new RegExp(words.map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'), 'iu');
  for (const field of [item.field, ...ideaReviewBlocks, 'track' as const]) {
    const match = pattern.exec(draft[field]);
    // Reflowed whitespace can make the verbatim span longer than the quote limit; keep its leading part, still verbatim.
    if (match) return { field, quote: match[0].slice(0, maxQuoteChars).trim() };
  }
  return null;
}

export function validateIdeaReview(value: unknown, draft: IdeaDraft): IdeaReview {
  draft = ideaDraftSchema.parse(draft);
  const parsed = ideaReviewSchema.parse(value);
  const located = (evidence: Quote[]) => evidence.map(item => locateQuote(item, draft) ?? item);
  const report: IdeaReview = { ...parsed, blocks: parsed.blocks.map(item => ({ ...item, evidence: located(item.evidence) })),
    discussant: { delta: { ...parsed.discussant.delta, evidence: located(parsed.discussant.delta.evidence) }, poc: { ...parsed.discussant.poc, evidence: located(parsed.discussant.poc.evidence) } } };
  const advice = [report.summary, ...report.blocks.flatMap(item => [item.gap, item.improvement]), report.discussant.delta.answer, report.discussant.poc.answer, ...report.nextSteps];
  if (advice.some(text => /\p{Script=Han}/u.test(text))) throw new Error('AI advice must be in English. Please try again. Original evidence quotations may remain in their source language.');
  if (new Set(report.blocks.map(item => item.block)).size !== ideaReviewBlocks.length) throw new Error('The review must cover every pitch block once.');
  const quotes = [...report.blocks.flatMap(item => item.evidence), ...report.discussant.delta.evidence, ...report.discussant.poc.evidence];
  if (quotes.some(item => !draft[item.field].includes(item.quote))) throw new Error('The review cited text not present in this pitch.');
  for (const item of report.blocks) {
    if (!draft[item.block].trim() && item.status !== 'missing') throw new Error('Empty pitch blocks must be marked missing.');
    if (item.status !== 'missing' && !item.evidence.some(quote => quote.field === item.block)) throw new Error('Each assessed block must quote that block.');
  }
  if (Object.values(report.discussant).some(item => item.status !== 'unanswered' && !item.evidence.length)) throw new Error('Discussant answers require pitch evidence.');
  return report;
}
