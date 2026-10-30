import 'dotenv/config';
import { NextResponse } from 'next/server';
import { AuthError, requireSessionUser } from '../../../../src/mastra/auth/session';
import { errorResponse } from '../../../../src/mastra/http/error-response';
import { recordAuditLog } from '../../../../src/mastra/db/audit-log';
import { canManageTheme } from '../../../../src/mastra/theme-meetings/access';
import {
  buildThemeMeetingPlan,
  buildThemeMeetingReminderRun,
  sendThemeMeetingAgendaEmails,
  sendThemeMeetingReminderEmails,
} from '../../../../src/mastra/theme-meetings/planner';
import { themeReminderActionSchema } from '../../../../src/mastra/theme-meetings/schema';

export const runtime = 'nodejs';

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export async function POST(request: Request) {
  try {
    const user = await requireSessionUser(request);
    const body = (await request.json()) as Record<string, unknown>;
    const parsedAction = themeReminderActionSchema.safeParse(body.action || 'manual_missing_update_reminder');
    const themeId = text(body.themeId);

    if (!parsedAction.success) {
      throw new Error('Invalid reminder action.');
    }

    if (!themeId) {
      throw new Error('themeId is required.');
    }

    const meetingDate = text(body.meetingDate);
    const payload = await buildThemeMeetingPlan({ meetingDate, validateUsers: true });
    if (!canManageTheme(payload.config, themeId, user)) {
      throw new AuthError('Only administrators, PIs, and the theme coordinator can send reminders.', 403, 'forbidden');
    }
    if (payload.plan.meetings.find((meeting) => meeting.theme_id === themeId)?.cancelled) {
      throw new Error(`Theme ${themeId} meeting on ${payload.plan.meeting_date} has been cancelled.`);
    }

    const run = await buildThemeMeetingReminderRun(parsedAction.data, {
      meetingDate,
      themeId,
      validateUsers: true,
    });
    const emails = await sendThemeMeetingReminderEmails(run.notifications);
    const agendaEmails =
      run.action === 'agenda_cutoff' || run.action === 'agenda_preview'
        ? await sendThemeMeetingAgendaEmails(run.plan, payload.config, { themeId, phase: run.action === 'agenda_preview' ? 'preview' : 'final' })
        : { sent: 0, skipped: 0, failed: 0 };

    await recordAuditLog({
      actor: user,
      action: 'theme_meeting.reminder_run',
      targetType: 'theme_meeting',
      targetId: themeId,
      summary: 'Theme meeting reminder run built.',
      metadata: {
        meetingDate: meetingDate || null,
        reminderAction: run.action,
        notificationCount: run.notifications.length,
        emailSent: emails.sent,
        emailSkipped: emails.skipped,
        emailFailed: emails.failed,
        agendaEmailSent: agendaEmails.sent,
        agendaEmailSkipped: agendaEmails.skipped,
        agendaEmailFailed: agendaEmails.failed,
      },
    });
    // Counts and recipients only: reminder texts belong to the addressed members.
    return NextResponse.json({
      action: run.action,
      meetingDate: run.plan.meeting_date,
      themeId,
      notificationCount: run.notifications.length,
      recipients: run.notifications.map((notification) => ({
        username: notification.member_username || null,
        displayName: notification.member,
      })),
      emails,
      agendaEmails,
    });
  } catch (error) {
    return errorResponse(error, 400);
  }
}
