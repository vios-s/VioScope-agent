import type { ProjectTask } from '../projects/workflow';
import { z } from 'zod';
import type { RedTeamState } from './internal-red-team';

export const internalChecklist = [
  ['story', 'The abstract, introduction and conclusion tell a consistent story.'],
  ['motivation', 'The motivation is supported by appropriate evidence.'],
  ['claims', 'Each main claim maps to evidence in a figure, table or proof.'],
  ['notation', 'Mathematical notation is consistent.'],
  ['figures', 'Figures and captions explain the result independently.'],
  ['variance', 'Uncertainty, seeds and variability are reported where applicable.'],
  ['legibility', 'Figures are legible and accessible.'],
  ['presentation', 'The manuscript has complete sentences and a coherent layout.'],
  ['baselines', 'Comparisons support the claimed scientific contribution.'],
  ['ablations', 'Ablations or equivalent analysis isolate the contribution.'],
  ['significance', 'The results are meaningful and limitations are stated.'],
] as const;
const text = z.string().trim().max(8000);
const required = text.min(1);
const uuid = z.string().uuid();
export const manuscriptSchema = z.object({ label: z.string().trim().min(1).max(200), evidenceId: uuid }).strict();
export const metaReviewSchema = z.object({
  summary: text, score: z.number().int().min(1).max(10), confidence: z.number().int().min(1).max(5),
  strengths: text, weaknesses: text, questions: text,
  checklist: z.array(z.object({ key: z.enum(internalChecklist.map(item => item[0])), verdict: z.enum(['yes','no','not_applicable']), evidence: text }).strict()).max(11),
  changes: z.array(z.object({ id: uuid, text, evidence: text }).strict()).max(30),
}).strict();
export type MetaReview = z.infer<typeof metaReviewSchema>;
export type ReviewVersion = { version: number; at: string; content: MetaReview };
export type ReviewerRecord = { username: string; draft?: MetaReview; versions: ReviewVersion[] };
export type RevisionDisposition = { reviewId: string; version: number; findingId: string; kind: 'required'|'suggested'|'declined'; reason: string; taskId: string|null; by: string; at: string };
export type ReviewRoundData = {
  redTeam?: RedTeamState;
  manuscript: z.infer<typeof manuscriptSchema>; pdra: string; invited: string[]; profileRevision: number; projectSnapshot: unknown;
  reviews: Record<string,ReviewerRecord>; dispositions: RevisionDisposition[];
  responses: { reviewId: string; by: string; at: string; text: string }[];
  history: { by: string; at: string; action: string; detail: unknown }[];
  lock?: { by: string; at: string; fingerprint: string; reason: string; finalManuscript: z.infer<typeof manuscriptSchema> };
  clearance?: { by: string; at: string; fingerprint: string; outcome: 'submit'|'defer'; reason: string };
};
export type ReviewRound = { id: string; projectId: string; submissionId: string; revision: number; createdAt: string; data: ReviewRoundData };
const base = { roundId: uuid, revision: z.number().int().nonnegative(), confirmed: z.literal(true) };
export const internalReviewCommand = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('start'), confirmed: z.literal(true), submissionId: uuid, previousRoundId: uuid.nullable(), manuscript: manuscriptSchema }).strict(),
  z.object({ operation: z.literal('review'), ...base, content: metaReviewSchema, publish: z.boolean() }).strict(),
  z.object({ operation: z.literal('invite'), ...base, username: z.string().trim().min(1).max(100) }).strict(),
  z.object({ operation: z.literal('respond'), ...base, reviewId: uuid, text: required }).strict(),
  z.object({ operation: z.literal('triage'), ...base, reviewId: uuid, version: z.number().int().positive(), findingId: uuid, kind: z.enum(['required','suggested','declined']), reason: required, owner: z.string().trim().min(1), dueDate: z.iso.date().nullable() }).strict(),
  z.object({ operation: z.literal('verify'), ...base, taskId: uuid, taskRevision: z.number().int().nonnegative(), accepted: z.boolean(), reason: required }).strict(),
  z.object({ operation: z.literal('retire_task'), ...base, taskId: uuid, taskRevision: z.number().int().nonnegative(), reason: required }).strict(),
  z.object({ operation: z.literal('lock'), ...base, reason: required, finalManuscript: manuscriptSchema }).strict(),
  z.object({ operation: z.literal('clearance'), ...base, outcome: z.enum(['submit','defer']), reason: required }).strict(),
]);
export type InternalReviewCommand = z.infer<typeof internalReviewCommand>;

export function validatePublishedReview(content: MetaReview) {
  if (!content.summary || !content.strengths || !content.weaknesses) throw new Error('Complete the summary, strengths and weaknesses before submitting.');
  if (content.changes.some(item=>!item.text||!item.evidence)) throw new Error('Every requested revision needs a change and draft evidence.');
  if (new Set(content.changes.map(item => item.id)).size !== content.changes.length) throw new Error('Revision items must have distinct IDs.');
  if (content.checklist.length !== internalChecklist.length || new Set(content.checklist.map(item => item.key)).size !== internalChecklist.length || content.checklist.some(item => !item.evidence)) throw new Error('Assess every checklist item with draft evidence or a reason it is not applicable.');
}

/** Earlier rounds and replaced review versions can be explicitly retired by the lead. */
export function supersededReviewTask(round: ReviewRound, task: ProjectTask) {
  return task.sourceKind === 'internal_review' && (task.sourceId !== round.id || !round.data.dispositions.some(d =>
    d.taskId === task.id && d.version === round.data.reviews[d.reviewId]?.versions.at(-1)?.version &&
    round.data.reviews[d.reviewId]?.versions.at(-1)?.content.changes.some(f => f.id === d.findingId)));
}
