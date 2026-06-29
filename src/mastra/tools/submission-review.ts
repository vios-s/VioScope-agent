import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { defaultSubmissionReviewSkills, reviewSubmission } from '../submission/review';
import { submissionReviewStructuredSchema } from '../submission/schema';

export const submissionReviewTool = createTool({
  id: 'run-submission-review',
  description:
    'Run the VIOS B2 pre-submission review harness over a draft using configured runtime skills. Use for Skeleton Lock, PDRA meta-review, internal red-team, revision-lock, or submission readiness tasks.',
  inputSchema: z
    .object({
      draftText: z.string().trim().min(1).optional().describe('Draft text pasted by the user.'),
      draftName: z.string().trim().min(1).optional().describe('Human-readable name for pasted draft text.'),
      skills: z.array(z.string().trim().min(1)).default([...defaultSubmissionReviewSkills]).optional(),
      targetVenue: z.string().trim().min(1).optional(),
      deadline: z.string().trim().min(1).optional(),
      maxDraftChars: z.number().int().positive().optional(),
      maxOutputTokens: z.number().int().positive().optional(),
    })
    .refine((input) => Boolean(input.draftText), {
      message: 'Provide draftText.',
    }),
  outputSchema: z.object({
    report: z.string(),
    structured: submissionReviewStructuredSchema,
    draftName: z.string(),
    skills: z.array(
      z.object({
        name: z.string(),
        version: z.string().optional(),
        sourcePath: z.string(),
      }),
    ),
    draftTruncated: z.boolean(),
    draftChars: z.number(),
    finishReason: z.string(),
  }),
  mcp: {
    annotations: {
      title: 'Run Submission Review',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  execute: async (input) => reviewSubmission(input),
  toModelOutput: (output) => ({
    type: 'text',
    value: output.report,
  }),
});
