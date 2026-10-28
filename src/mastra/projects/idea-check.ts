import { z } from 'zod';
import type { SavedIdeaReview } from './idea-review-schema';

export const ideaFields = [
  { key: 'question', label: 'Research question', hint: 'What problem or question will this project address?' },
  { key: 'importance', label: 'Why it matters', hint: 'Who benefits, or what scientific understanding could change?' },
  { key: 'contribution', label: 'Contribution beyond existing work', hint: 'Compare with named related work and include references.' },
  { key: 'evidence', label: 'Reasoning or initial evidence', hint: 'Record observations, motivation experiments, assumptions or proof sketches. Include sources or artifact references.' },
  { key: 'validation', label: 'Validation plan', hint: 'Describe the experiment, proof or feasibility check, and what result would support or challenge the idea.' },
  { key: 'resources', label: 'Resources and access', hint: 'People, time, compute, data access and approvals needed. State what is already available.' },
  { key: 'risks', label: 'Risks and alternatives', hint: 'What could fail? What would you change or test next?' },
  { key: 'milestone', label: 'Next milestone', hint: 'State a concrete outcome, responsible person and target date.' },
] as const;
const field = z.string().trim().max(4000).default('');
export const ideaDraftSchema = z.object({ question: field, importance: field, contribution: field, evidence: field,
  validation: field, resources: field, risks: field, milestone: field }).strict();
export type IdeaDraft = z.infer<typeof ideaDraftSchema>;
export const ideaDecisionSchema = z.object({ outcome: z.enum(['proceed', 'revise', 'stop']),
  rationale: z.string().trim().min(1).max(4000), nextMilestone: z.string().trim().min(1).max(2000) }).strict();
export type IdeaDecision = z.infer<typeof ideaDecisionSchema>;
export const ideaSourceSchema = z.object({ name: z.string().max(200), text: z.string().max(32000), method: z.enum(['upload', 'paste']) }).strict();
export type IdeaSource = z.infer<typeof ideaSourceSchema>;
export const ideaCommandSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('save'), title: z.string().trim().max(200).optional(), version: z.number().int().min(0), draft: ideaDraftSchema, source: ideaSourceSchema.nullable().default(null) }).strict(),
  z.object({ operation: z.literal('decide'), version: z.number().int().min(1), decision: ideaDecisionSchema, confirmed: z.literal(true) }).strict(),
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
export function defaultPitchExportFormat(sourceName?: string): PitchExportFormat {
  const extension = sourceName?.split('.').pop()?.toLowerCase();
  return pitchExportFormats.includes(extension as PitchExportFormat) ? extension as PitchExportFormat : 'docx';
}
