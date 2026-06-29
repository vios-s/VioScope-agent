import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { canSeeAll, isUserName } from '../auth/session';
import type { AuthUser } from '../db/users';
import { visiblePlanForUser } from '../theme-meetings/access';
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

function requestUser(context: { requestContext?: { get: (key: string) => unknown } } | undefined): AuthUser {
  const user = context?.requestContext?.get('vioscope-user') as AuthUser | undefined;
  if (!user?.id || !user.username) {
    throw new Error('Theme meeting tools require a signed-in VioScope user context.');
  }
  return user;
}

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
  execute: async (input, context) => {
    const user = requestUser(context);
    const { config, plan } = await buildThemeMeetingPlan({ meetingDate: input.meetingDate, validateUsers: true });
    const visiblePlan = visiblePlanForUser(plan, config, user);
    return {
      plan: visiblePlan,
      markdown: renderThemeMeetingPlan(visiblePlan),
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
    'Submit or replace one advisory theme-meeting slot after the user explicitly asks to save it. Slot types are nothing_to_report, deep_dive, milestone_check, and strategic_slot.',
  inputSchema: z.object({
    meetingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    themeId: z.string().trim().min(1),
    member: z.string().trim().min(1),
    updateType: themeUpdateTypeSchema,
    progressText: z.string().trim().optional(),
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
  execute: async (input, context) => {
    const user = requestUser(context);
    if (!canSeeAll(user) && !isUserName(input.member, user)) {
      throw new Error('Members can only submit their own theme meeting update.');
    }
    const { config } = await buildThemeMeetingPlan({ meetingDate: input.meetingDate, validateUsers: true });
    const { update, plan } = await submitThemeMeetingUpdate({
      ...input,
      submittedVia: 'chat',
      validateUsers: true,
    });
    const visiblePlan = visiblePlanForUser(plan, config, user);
    return {
      update,
      plan: visiblePlan,
      markdown: renderThemeMeetingPlan(visiblePlan),
    };
  },
  toModelOutput: (output) => ({
    type: 'text',
    value: `Saved update for ${output.update.member} in Theme ${output.update.theme_id}.\n\n${renderThemeMeetingPlan(
      output.plan as ThemeMeetingPlan,
    )}`,
  }),
});
