import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  buildThemeMeetingPlan,
  renderThemeMeetingPlan,
  submitThemeMeetingUpdate,
} from '../theme-meetings/planner';
import {
  themeMeetingPlanSchema,
  themeMeetingUpdateSchema,
  themeUpdateTypeSchema,
  type ThemeMeetingPlan,
} from '../theme-meetings/schema';

export const readThemeMeetingPlanTool = createTool({
  id: 'read-theme-meeting-plan',
  description:
    'Read the VIOS theme-meeting config and member updates, then generate the active AB/CD meeting plan for a date.',
  inputSchema: z.object({
    meetingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }),
  outputSchema: z.object({
    plan: themeMeetingPlanSchema,
    markdown: z.string(),
  }),
  mcp: {
    annotations: {
      title: 'Read Theme Meeting Plan',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  execute: async (input) => {
    const { plan } = await buildThemeMeetingPlan({ meetingDate: input.meetingDate });
    return {
      plan,
      markdown: renderThemeMeetingPlan(plan),
    };
  },
  toModelOutput: (output) => ({
    type: 'text',
    value: output.markdown,
  }),
});

export const submitThemeMeetingUpdateTool = createTool({
  id: 'submit-theme-meeting-update',
  description:
    'Submit or replace one member theme-meeting update after the user explicitly asks to save it. Requires theme, member, update type, progress text, and questions for short/deep updates.',
  inputSchema: z.object({
    meetingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    themeId: z.string().trim().min(1),
    member: z.string().trim().min(1),
    updateType: themeUpdateTypeSchema,
    progressText: z.string().trim().min(1),
    questions: z.string().trim().optional(),
  }),
  outputSchema: z.object({
    update: themeMeetingUpdateSchema,
    plan: themeMeetingPlanSchema,
    markdown: z.string(),
  }),
  mcp: {
    annotations: {
      title: 'Submit Theme Meeting Update',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  execute: async (input) => {
    const { update, plan } = await submitThemeMeetingUpdate({
      ...input,
      submittedVia: 'chat',
    });
    return {
      update,
      plan,
      markdown: renderThemeMeetingPlan(plan),
    };
  },
  toModelOutput: (output) => ({
    type: 'text',
    value: `Saved update for ${output.update.member} in Theme ${output.update.theme_id}.\n\n${renderThemeMeetingPlan(
      output.plan as ThemeMeetingPlan,
    )}`,
  }),
});
