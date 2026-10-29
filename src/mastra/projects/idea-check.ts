import { z } from 'zod';
import type { SavedIdeaReview } from './idea-review-schema';

export const ideaFields = [
  { key: 'why', label: '1. The Why (The Hook)', hint: 'The Pain Point: What is the specific bottleneck or gap in current ML that you are solving?\n\nTarget Audience: Who (which sub-community) will cite this, and why does it change their lives?\n\nThe Wild Factor: Is this a “safe” incremental step or a “high-risk” wild pivot? If wild, what is the “intuition” (preliminary evidence) that it might actually work?' },
  { key: 'context', label: '2. The Context (The Landscape)', hint: 'The Giants: What is the current SOTA, and whose work are you building on?\n\nThe Graveyard: Has this been tried and failed? If so, why will we succeed where they didn\'t? (e.g., better compute, new insight, different data).' },
  { key: 'strategy', label: '3. The What (The Technical Strategy)', hint: 'The Core Idea: Explain the “trick” or “mechanism” simply.\n\nData & Compute: What datasets are needed? Do we have the GPU/National Platform capacity for this?\n\nThe Pipeline: High-level steps from t=0 to submission.\n\nThe Kill Switch: What single experiment proves this is a waste of time?' },
  { key: 'execution', label: '4. The De-Risk (The Execution)', hint: 'The 2-Week Experiment: What is the single proof-of-concept experiment that, if it fails, kills the project immediately?\n\nEvaluation: How do we prove we won? (Metrics/Benchmarks).\n\nTimeline: How many submission cycles (as per the VIOS calendar) will this take?' },
  { key: 'resourcePlan', label: '5. The Resources', hint: 'The dataset: What kind of dataset are you planning to use? Has it already been downloaded, or do you require extra storage?\n\nThe computation: What kind of computation do you estimate you will need? CPU only or GPUs? At what scale (which GPU, how many, and for how long)?\n\nThe human labour: Do you need any human involvement or judgement?' },
] as const;
const legacyGroups = {
  why: [['Pain point', 'question'], ['Target audience', 'importance'], ['Wild factor', 'evidence']],
  context: [['Related work', 'contribution'], ['Previous attempts', 'previousAttempts']],
  strategy: [['Core idea', 'coreIdea'], ['Data and compute', 'dataCompute'], ['Pipeline', 'pipeline'], ['Kill switch', 'killSwitch'], ['Risks and alternatives', 'risks']],
  execution: [['Two-week experiment', 'experiment'], ['Evaluation', 'validation'], ['Timeline', 'timeline'], ['Next milestone', 'milestone']],
  resourcePlan: [['Dataset', 'dataset'], ['Computation', 'compute'], ['Human labour', 'humanLabour'], ['Other resources and access', 'resources']],
} as const;
const field = z.string().trim().max(4000).default('');
const rawIdeaDraftSchema = z.object({
  question: field, importance: field, contribution: field, evidence: field, validation: field, resources: field, risks: field, milestone: field,
  previousAttempts: field, coreIdea: field, dataCompute: field, pipeline: field, killSwitch: field, experiment: field,
  timeline: field, dataset: field, compute: field, humanLabour: field,
  why: z.string().trim().max(24000).default(''), context: z.string().trim().max(24000).default(''),
  strategy: z.string().trim().max(24000).default(''), execution: z.string().trim().max(24000).default(''), resourcePlan: z.string().trim().max(24000).default(''), track: z.enum(['', 'A', 'B']).default(''),
}).strict();
export const ideaDraftSchema = z.preprocess(input => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const draft = { ...input as Record<string, unknown> };
  for (const [key, entries] of Object.entries(legacyGroups)) {
    if (Object.prototype.hasOwnProperty.call(draft, key)) continue;
    draft[key] = entries.map(([label, name]) => typeof draft[name] === 'string' && String(draft[name]).trim() ? `${label}: ${String(draft[name]).trim()}` : '').filter(Boolean).join('\n\n');
  }
  return draft;
}, rawIdeaDraftSchema);
export type IdeaDraft = z.infer<typeof ideaDraftSchema>;
export const initialProjectActionSchema = z.object({ text: z.string().trim().min(1).max(240), dueDate: z.iso.date() }).strict();

export const ideaOutcomeLabels = { proceed: 'Proceed', revise: 'Revise', stop: 'Stop' } as const;
export const ideaTitleSchema = z.string().trim().min(1, 'Enter a pitch title.').max(200, 'Keep the pitch title within 200 characters.');
export const ideaDecisionSchema = z.object({ outcome: z.enum(['proceed', 'revise', 'stop']),
  rationale: z.string().trim().min(1, 'Enter the reason and evidence for the decision.').max(4000), nextMilestone: z.string().trim().min(1, 'Enter the next milestone or closure plan.').max(2000) }).strict();
export type IdeaDecision = z.infer<typeof ideaDecisionSchema>;
export const ideaSourceSchema = z.object({ name: z.string().max(200), text: z.string().max(32000), method: z.enum(['upload', 'paste']) }).strict();
export type IdeaSource = z.infer<typeof ideaSourceSchema>;
export const ideaCommandSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('save'), title: ideaTitleSchema.optional(), version: z.number().int().min(0), draft: ideaDraftSchema, source: ideaSourceSchema.nullable().default(null) }).strict(),
  z.object({ operation: z.literal('decide'), version: z.number().int().min(1), decision: ideaDecisionSchema, confirmed: z.literal(true, { error: 'Confirm the human decision before recording it.' }) }).strict(),
]);
export type IdeaCommand = z.infer<typeof ideaCommandSchema>;
export type IdeaRevision = { title?: string; version: number; draft: IdeaDraft; source: IdeaSource | null; decision: IdeaDecision | null;
  by: string; at: string; operation: 'save' | 'decide' };
export type IdeaPitch = { access?: 'owner' | 'pi' | 'shared'; version?: number; updatedAt?: string; id: string; title: string; ownerUsername: string; projectId: string | null; outcome: string | null };
export type IdeaCheckPayload = { reviews: SavedIdeaReview[]; pitch: IdeaPitch; current: IdeaRevision | null; history: IdeaRevision[]; canEdit: boolean; canManage: boolean; collaborators: string[] };
export function checkIdea(draft: IdeaDraft) {
  return ideaFields.map((item) => ({ ...item, present: Boolean(draft[item.key].trim()), evidence: draft[item.key] }));
}

export const pitchExportFormats = ['docx', 'pdf', 'md', 'txt'] as const;
export type PitchExportFormat = typeof pitchExportFormats[number];
export function pitchExportFilename(title: string, version: number, format: PitchExportFormat) {
  const slug = title.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
  return `idea-pitch-${slug || 'untitled'}-v${version}.${format}`;
}
export function defaultPitchExportFormat(sourceName?: string): PitchExportFormat {
  const extension = sourceName?.split('.').pop()?.toLowerCase();
  return pitchExportFormats.includes(extension as PitchExportFormat) ? extension as PitchExportFormat : 'docx';
}
