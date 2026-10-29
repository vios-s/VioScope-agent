import { z } from 'zod';

export const submissionReviewVerdictSchema = z.enum(['CLEARED', 'CONDITIONAL', 'SLIDE']);
export const submissionReviewFindingStatusSchema = z.enum(['pass', 'partial', 'fail', 'missing', 'conditional']);
export const submissionReviewPrioritySchema = z.enum(['P0', 'P1', 'P2', 'P3']);

const appliedSkillSchema = z.object({
  name: z.string().min(1),
  version: z.string(),
  sourcePath: z.string().min(1),
});

const findingSchema = z.object({
  area: z.string().min(1),
  status: submissionReviewFindingStatusSchema,
  evidence: z.array(z.string()).describe('Evidence citations such as draft:L12-L18, or "missing".'),
  gap: z.string(),
  requiredAction: z.string(),
});

const mitigationSchema = z.object({
  priority: submissionReviewPrioritySchema,
  risk: z.string().min(1),
  action: z.string().min(1),
  owner: z.string(),
  due: z.string(),
  evidenceNeeded: z.string(),
});

const humanSignOffSchema = z.object({
  leadPdra: z.string(),
  piOrOrganizer: z.string(),
  remainingEvidenceNeeded: z.array(z.string()),
});

// Skeleton Lock only: advisory per-requirement reading of the VIOS Paper Skeleton minimum content.
export const paperSkeletonStatusSchema = z.enum(['met', 'partly', 'missing', 'unknown']);
const paperSkeletonItemSchema = z.object({
  id: z.string().min(1),
  status: paperSkeletonStatusSchema,
  evidence: z.string().describe('A short verbatim quote from the draft, or "not found".'),
});

const perSkillNoteSchema = z.object({
  skill: z.string().min(1),
  notes: z.array(z.string()),
});

export const submissionReviewModelOutputSchema = z.object({
  verdict: submissionReviewVerdictSchema,
  summary: z.string().min(1),
  findings: z.array(findingSchema),
  reasonsToReject: z.array(z.string()),
  checkmateQuestions: z.array(z.string()),
  mitigations: z.array(mitigationSchema),
  humanSignOff: humanSignOffSchema,
  perSkillNotes: z.array(perSkillNoteSchema),
  paperSkeleton: z.array(paperSkeletonItemSchema).optional(),
});

export const submissionReviewStructuredSchema = submissionReviewModelOutputSchema.extend({
  appliedSkills: z.array(appliedSkillSchema),
  // Saved reviews before this checklist have no paperSkeleton. `measured` is computed by the server, never by the model;
  // `quoteFound` records whether the quoted evidence occurs in the supplied text.
  paperSkeleton: z.array(paperSkeletonItemSchema.extend({ quoteFound: z.boolean(), measured: z.string().optional() })).optional(),
});

export type SubmissionReviewStructured = z.infer<typeof submissionReviewStructuredSchema>;
