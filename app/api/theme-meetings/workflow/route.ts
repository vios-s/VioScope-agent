import 'dotenv/config';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { AuthError, requireSessionUser } from '../../../../src/mastra/auth/session';
import { errorResponse } from '../../../../src/mastra/http/error-response';
import { recordAuditLog } from '../../../../src/mastra/db/audit-log';
import { getProjectForUser, listProjectsForUser } from '../../../../src/mastra/db/projects';
import { getUserByUsername } from '../../../../src/mastra/db/users';
import { canManageTheme } from '../../../../src/mastra/theme-meetings/access';
import { buildThemeMeetingPlan } from '../../../../src/mastra/theme-meetings/planner';
import { resolveThemeMeetingUpdatesPath } from '../../../../src/mastra/theme-meetings/store';
import { contentHash, withFileLock } from '../../../../src/mastra/atomic-file';
import { addMeetingAction, agendaSelectionSchema, agendaSourceVersion, changeMeetingWorkflow, confirmAgenda,
  latestConfirmation, meetingDateSchema, newActionSchema, readMeetingWorkflow, updateMeetingAction,
} from '../../../../src/mastra/theme-meetings/workflow';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const keySchema = z.object({ meetingDate: meetingDateSchema, themeId: z.string().trim().min(1).max(100) });
const commandSchema = z.discriminatedUnion('operation', [
  keySchema.extend({ operation: z.literal('confirm'), sourceVersion: z.string(), entries: agendaSelectionSchema }),
  keySchema.extend({ operation: z.literal('add_action'), action: newActionSchema }),
  keySchema.extend({ operation: z.literal('update_action'), id: z.string().uuid(), version: z.string(),
    status: z.enum(['open', 'done']), note: z.string().trim().min(1).max(2000) }),
]);

async function context(request: Request, key: z.infer<typeof keySchema>) {
  const user = await requireSessionUser(request);
  const payload = await buildThemeMeetingPlan({ meetingDate: key.meetingDate, validateUsers: true, rawAgenda: true });
  const meeting = payload.plan.meetings.find((item) => item.theme_id === key.themeId);
  if (!meeting) throw new Error('This theme is not scheduled on that date.');
  const manager = canManageTheme(payload.config, key.themeId, user);
  if (!manager && !meeting.member_usernames.includes(user.username)) {
    throw new AuthError('Only theme members and managers can access meeting records.', 403, 'forbidden');
  }
  return { user, meeting, manager };
}
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const key = keySchema.parse({ meetingDate: params.get('meetingDate'), themeId: params.get('themeId') });
    const { user, meeting, manager } = await context(request, key);
    const state = await readMeetingWorkflow();
    const confirmation = latestConfirmation(state, key.meetingDate, key.themeId);
    const projects = await listProjectsForUser(user, { includeArchived: true });
    const projectTitles = new Map(projects.map((project) => [project.id, project.title]));
    const visible = (username?: string) => manager || username === user.username;
    return NextResponse.json({
      manager, cancelled: meeting.cancelled, duration: meeting.duration_minutes,
      sourceVersion: agendaSourceVersion(meeting, confirmation),
      candidates: meeting.agenda_items.filter((item) => visible(item.member_username)),
      confirmation: confirmation ? { ...confirmation, entries: confirmation.entries.filter((item) => visible(item.member_username)) } : null,
      projects: manager ? projects.filter((project) => project.lifecycle !== 'archived').map(({ id, title }) => ({ id, title })) : [],
      members: manager ? meeting.member_usernames : [user.username],
      actions: state.actions.filter((action) => action.themeId === key.themeId && action.meetingDate <= key.meetingDate &&
        visible(action.owner) && (!action.projectId || projectTitles.has(action.projectId))).map((action) => ({ ...action,
          projectTitle: action.projectId ? projectTitles.get(action.projectId) : null, version: contentHash(action) })),
    });
  } catch (error) { return errorResponse(error, 400); }
}
export async function POST(request: Request) {
  try {
    await requireSessionUser(request);
    const command = commandSchema.parse(await request.json());
    // Match the submission writer's lock, then serialize agenda/action revisions.
    const result = await withFileLock(resolveThemeMeetingUpdatesPath(), async () => changeMeetingWorkflow({}, async (state) => {
      const { user, meeting, manager } = await context(request, command);
      if (command.operation !== 'update_action' && !manager) throw new AuthError('Only the theme coordinator, PI or administrator can do this.', 403, 'forbidden');
      if (meeting.cancelled && command.operation !== 'update_action') throw new Error('This meeting is cancelled.');
      if (command.operation === 'confirm') {
        if (agendaSourceVersion(meeting, latestConfirmation(state, command.meetingDate, command.themeId)) !== command.sourceVersion) {
          throw new AuthError('The submissions or confirmed agenda changed. Reload and review before confirming.', 409, 'conflict');
        }
        confirmAgenda(state, meeting, command.meetingDate, command.entries, user.username);
      } else if (command.operation === 'add_action') {
        if (!latestConfirmation(state, command.meetingDate, command.themeId)) throw new Error('Confirm the agenda before recording meeting actions.');
        const owner = await getUserByUsername(command.action.owner);
        if (!owner || owner.provisioningStatus !== 'active' || !meeting.member_usernames.includes(owner.username)) throw new Error('Choose an active theme member as the assignee.');
        if (command.action.projectId) {
          const project = await getProjectForUser(command.action.projectId, user);
          if (project.lifecycle === 'archived') throw new Error('Choose an active project.');
          await getProjectForUser(command.action.projectId, owner);
        }
        addMeetingAction(state, command.themeId, command.meetingDate, command.action, user.username);
      } else {
        const action = state.actions.find((item) => item.id === command.id && item.themeId === command.themeId && item.meetingDate <= command.meetingDate);
        if (!action || (!manager && action.owner !== user.username)) throw new AuthError('Action is unavailable.', 403, 'forbidden');
        if (action.projectId) await getProjectForUser(action.projectId, user);
        if (contentHash(action) !== command.version) throw new AuthError('This action changed. Reload before saving.', 409, 'conflict');
        updateMeetingAction(action, command.status, command.note, user.username, manager);
      }
      return { user };
    }));
    await recordAuditLog({ actor: result.user, action: `theme_meeting.${command.operation}`, targetType: 'theme_meeting',
      targetId: command.themeId, summary: 'Theme meeting workflow updated.', metadata: { meetingDate: command.meetingDate } });
    return NextResponse.json({ ok: true });
  } catch (error) { return errorResponse(error, 400); }
}
