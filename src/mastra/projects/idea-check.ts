import { z } from 'zod';
import type { SavedIdeaReview } from './idea-review-schema';

export const ideaFields = [
  { key: 'question', section: '1. The Why', label: 'The Pain Point', hint: 'What specific bottleneck or gap are you solving?' },
  { key: 'importance', section: '1. The Why', label: 'Target Audience', hint: 'Who will use or cite this work, and why does it matter to them?' },
  { key: 'evidence', section: '1. The Why', label: 'The Wild Factor', hint: 'Is the idea incremental or high-risk? What intuition or early evidence suggests it might work?' },
  { key: 'contribution', section: '2. The Context', label: 'The Giants', hint: 'What is the current state of the art, and whose work are you building on? Include references.' },
  { key: 'previousAttempts', section: '2. The Context', label: 'The Graveyard', hint: 'Has this been tried before? If it failed, why might this attempt succeed?' },
  { key: 'coreIdea', section: '3. The What', label: 'The Core Idea', hint: 'Explain the main mechanism or trick in simple terms.' },
  { key: 'dataCompute', section: '3. The What', label: 'Data & Compute', hint: 'What data and computing capacity does the idea need, and are they available?' },
  { key: 'pipeline', section: '3. The What', label: 'The Pipeline', hint: 'Outline the main steps from the start of the project to submission.' },
  { key: 'killSwitch', section: '3. The What', label: 'The Kill Switch', hint: 'What single experiment would show that this idea is not worth pursuing?' },
  { key: 'experiment', section: '4. The De-Risk', label: 'The 2-Week Experiment', hint: 'Describe the single proof-of-concept experiment that could stop the project if it fails.' },
  { key: 'validation', section: '4. The De-Risk', label: 'Evaluation', hint: 'Which metrics and benchmarks will show whether the idea works?' },
  { key: 'timeline', section: '4. The De-Risk', label: 'Timeline', hint: 'How many submission cycles will the work take?' },
  { key: 'dataset', section: '5. The Resources', label: 'The Dataset', hint: 'What dataset is needed? Is it already available, or is extra storage required?' },
  { key: 'compute', section: '5. The Resources', label: 'The Computation', hint: 'Estimate CPU or GPU type, quantity and time required.' },
  { key: 'humanLabour', section: '5. The Resources', label: 'The Human Labour', hint: 'What human involvement or judgement is needed?' },
  { key: 'resources', section: 'Additional notes', label: 'Other resources and access', hint: 'Record other people, time, access or approvals needed.' },
  { key: 'risks', section: 'Additional notes', label: 'Risks and alternatives', hint: 'What else could fail, and what would you try instead?' },
  { key: 'milestone', section: 'Additional notes', label: 'Next milestone', hint: 'State an outcome, responsible person and target date.' },
] as const;
export const ideaReviewKeys = ['question', 'importance', 'contribution', 'evidence', 'validation', 'resources', 'risks', 'milestone'] as const;
const field = z.string().trim().max(4000).default('');
export const ideaDraftSchema = z.object({
  question: field, importance: field, contribution: field, evidence: field, validation: field, resources: field, risks: field, milestone: field,
  previousAttempts: field, coreIdea: field, dataCompute: field, pipeline: field, killSwitch: field, experiment: field,
  timeline: field, dataset: field, compute: field, humanLabour: field, track: z.enum(['', 'A', 'B']).default(''),
}).strict();
export type IdeaDraft = z.infer<typeof ideaDraftSchema>;
export const initialProjectActionSchema = z.object({ text: z.string().trim().min(1).max(240), dueDate: z.iso.date() }).strict();

export const ideaDecisionSchema = z.object({ outcome: z.enum(['proceed', 'revise', 'stop']),
  rationale: z.string().trim().min(1).max(4000), nextMilestone: z.string().trim().min(1).max(2000) }).strict();
export type IdeaDecision = z.infer<typeof ideaDecisionSchema>;
export const ideaSourceSchema = z.object({ name: z.string().max(200), text: z.string().max(32000), method: z.enum(['upload', 'paste']) }).strict();
export type IdeaSource = z.infer<typeof ideaSourceSchema>;
export const ideaCommandSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('save'), title: z.string().trim().min(1).max(200).optional(), version: z.number().int().min(0), draft: ideaDraftSchema, source: ideaSourceSchema.nullable().default(null) }).strict(),
  z.object({ operation: z.literal('decide'), version: z.number().int().min(1), decision: ideaDecisionSchema, confirmed: z.literal(true) }).strict(),
]);
export type IdeaCommand = z.infer<typeof ideaCommandSchema>;
export type IdeaRevision = { title?: string; version: number; draft: IdeaDraft; source: IdeaSource | null; decision: IdeaDecision | null;
  by: string; at: string; operation: 'save' | 'decide' };
export type IdeaPitch = { access?: 'owner' | 'pi' | 'shared'; version?: number; updatedAt?: string; id: string; title: string; ownerUsername: string; projectId: string | null; outcome: string | null };
export type IdeaCheckPayload = { reviews: SavedIdeaReview[]; pitch: IdeaPitch; current: IdeaRevision | null; history: IdeaRevision[]; canEdit: boolean; canManage: boolean; collaborators: string[] };
export function checkIdea(draft: IdeaDraft) {
  return ideaFields.filter(item => item.section !== 'Additional notes').map((item) => ({ ...item, present: Boolean(draft[item.key].trim()), evidence: draft[item.key] }));
}

export const pitchExportFormats = ['docx', 'pdf', 'md', 'txt'] as const;
export type PitchExportFormat = typeof pitchExportFormats[number];
export function defaultPitchExportFormat(sourceName?: string): PitchExportFormat {
  const extension = sourceName?.split('.').pop()?.toLowerCase();
  return pitchExportFormats.includes(extension as PitchExportFormat) ? extension as PitchExportFormat : 'docx';
}
