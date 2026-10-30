import { z } from 'zod';

export const researchPhases = ['unclassified', 'initial_validation', 'idea_lock', 'main_research', 'skeleton_lock', 'internal_review', 'revision_lock', 'submission', 'rebuttal', 'complete'] as const;
export const checkpointTypes = ['idea_lock', 'skeleton_lock', 'code_lock', 'internal_review', 'revision_lock', 'submission_clearance'] as const;
const text = z.string().trim().max(4000);
const required = text.min(1);
export const dateSchema = z.iso.date();
const ids = z.array(z.string().uuid()).max(100).default([]);
export const resourceSchema = z.object({ id: z.string().uuid(), kind: z.enum(['compute','data','people','approval']), need: required,
  status: z.enum(['needed','requested','available','blocked','not_applicable']), owner: z.string().trim().max(100), evidence: text, dueDate: dateSchema.nullable() }).strict();
export const researchSchema = z.object({ question: text.default(''), claim: text.default(''), validation: text.default(''),
  researchType: z.enum(['empirical','theoretical','translational','mixed','unspecified']).default('unspecified'),
  phase: z.enum(researchPhases).default('unclassified'), resourceNotes: text.default(''), risks: text.default(''), fallback: text.default(''),
  resources: z.array(resourceSchema).max(100).default([]) }).strict();
export type ResearchProfile = z.infer<typeof researchSchema>;
export const projectSetupSchema = z.object({ track: z.enum(['A','B']), piUsername: z.string().trim().nullable(), pdraUsername: z.string().trim().nullable(), piUsernames: z.array(z.string().trim().min(1)).max(100).optional(), pdraUsernames: z.array(z.string().trim().min(1)).max(100).optional(), collaborators: z.array(z.string().trim().min(1)).max(100) }).strict();
export const submissionSchema = z.object({ venue: z.string().trim().min(1).max(200), cycle: z.string().trim().min(1).max(100),
  deadline: z.iso.datetime({offset:true}), timezone: z.string().refine(value => { try {new Intl.DateTimeFormat('en',{timeZone:value});return true;}catch{return false;} }, 'Use an IANA timezone, such as Europe/London.') }).strict();
export type SubmissionPlan = z.infer<typeof submissionSchema>;
export type TaskData = { task: string; owner: string; dueDate: string | null; status: 'open'|'in_progress'|'blocked'|'done'|'cancelled'; priority: 'high'|'normal'; note: string; evidenceIds: string[]; history: {by:string;at:string;status:string;note:string}[]; decision?: string; themeId?: string; meetingDate?: string };
export type ProjectTask = {id:string;projectId:string|null;sourceKind:'project'|'meeting'|'review'|'internal_review';sourceId:string|null;revision:number;data:TaskData & { verification?: {by:string;at:string;revision:number;accepted:boolean;reason:string} }};
const base = { revision: z.number().int().nonnegative(), confirmed: z.literal(true) };
export const workflowCommandSchema = z.discriminatedUnion('operation', [
 z.object({operation:z.literal('research'),...base,profile:researchSchema,reason:required}).strict(),
 z.object({operation:z.literal('submission'),confirmed:z.literal(true),plan:submissionSchema,reason:required,currentId:z.string().uuid().nullable()}).strict(),
 z.object({operation:z.literal('submission_result'),...base,id:z.string().uuid(),outcome:z.enum(['planned','submitted','accepted','rejected','withdrawn','deferred']),submittedAt:z.iso.datetime({offset:true}).nullable(),reviews:text,lessons:text,nextPlan:text,reason:required}).strict(),
 z.object({operation:z.literal('evidence'),confirmed:z.literal(true),title:required,claim:required,kind:z.enum(['experiment','proof','feasibility','document']),state:z.enum(['planned','completed']),summary:required,artifactId:z.string().uuid().nullable(),url:z.url().refine(value=>/^https?:\/\//.test(value)).nullable()}).strict(),
 z.object({operation:z.literal('task'),confirmed:z.literal(true),task:required,owner:z.string().trim().min(1),dueDate:dateSchema.nullable(),priority:z.enum(['high','normal']),sourceKind:z.enum(['project','review']),sourceId:z.string().uuid().nullable()}).strict(),
 z.object({operation:z.literal('task_update'),...base,id:z.string().uuid(),status:z.enum(['open','in_progress','blocked','done','cancelled']),note:required,evidenceIds:ids,task:required.optional(),owner:z.string().trim().min(1).optional(),dueDate:dateSchema.nullable().optional(),priority:z.enum(['high','normal']).optional()}).strict(),
 z.object({operation:z.literal('decision'),confirmed:z.literal(true),checkpoint:z.enum(checkpointTypes),submissionId:z.string().uuid().nullable(),outcome:z.enum(['proceed','conditional','revise','defer','stop']),reason:required,conditions:text,reviewDue:dateSchema.nullable(),evidenceIds:ids,profileRevision:z.number().int().nonnegative(),skeletonReviewId:z.string().uuid().nullable(),rulesVersion:z.string().trim().min(1).max(100).default('project-checkpoints-v1')}).strict(),
]);
export type WorkflowCommand = z.infer<typeof workflowCommandSchema>;

// These are planned checks, never approval records. Keep the chosen deadline and timezone alongside them.
export function submissionTimeline(plan: SubmissionPlan) {
 const deadline = Date.parse(plan.deadline);
 return [ ['skeleton_lock',42],['code_lock',35],['internal_review',28],['revision_lock',14],['submission_clearance',2],['submission_target',1] ]
  .map(([checkpoint,days])=>({checkpoint:String(checkpoint),at:new Date(deadline-Number(days)*86400000).toISOString(),timezone:plan.timezone}));
}

// Three-way field merge after a research-profile version conflict. `base` is the version the draft
// started from. Defaults: a field only the other editor changed keeps Latest, a field only I changed
// keeps My draft, and a field both changed differently has no default (an explicit choice is required).
export type ResearchMergeChoice = 'latest' | 'mine';
export type ResearchMergeField = { key: keyof ResearchProfile; conflict: boolean; choice: ResearchMergeChoice | null };
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
export function researchMergeFields(base: ResearchProfile, latest: ResearchProfile, draft: ResearchProfile): ResearchMergeField[] {
 return (Object.keys(researchSchema.shape) as (keyof ResearchProfile)[]).flatMap(key => {
  if (same(latest[key], draft[key])) return [];
  const theirs = !same(base[key], latest[key]), mine = !same(base[key], draft[key]);
  return [{ key, conflict: theirs && mine, choice: theirs && mine ? null : mine ? 'mine' : 'latest' }];
 });
}
export function mergeResearchProfiles(latest: ResearchProfile, draft: ResearchProfile, choices: Partial<Record<keyof ResearchProfile, ResearchMergeChoice | null>>): ResearchProfile {
 const merged = { ...latest } as Record<keyof ResearchProfile, unknown>;
 for (const key of Object.keys(researchSchema.shape) as (keyof ResearchProfile)[]) {
  if (same(latest[key], draft[key])) continue;
  const choice = choices[key];
  if (!choice) throw new Error('Choose Latest or My draft for every field changed in both versions.');
  if (choice === 'mine') merged[key] = draft[key];
 }
 return researchSchema.parse(merged);
}
