import 'dotenv/config';
import { NextResponse } from 'next/server';
import { AuthError, requireSessionUser } from '../../../../src/mastra/auth/session';
import { errorResponse } from '../../../../src/mastra/http/error-response';
import { recordAuditLog } from '../../../../src/mastra/db/audit-log';
import { assertMeetingNotHeld, canManageTheme } from '../../../../src/mastra/theme-meetings/access';
import {
  buildThemeMeetingPlan,
  buildThemeMeetingReminderRun,
  sendThemeMeetingReminderEmails,
  submissionClosed,
} from '../../../../src/mastra/theme-meetings/planner';

export const runtime = 'nodejs';

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export async function POST(request: Request) {
  try {
    const user = await requireSessionUser(request);
    const body = (await request.json()) as Record<string, unknown>;
    const themeId = text(body.themeId);

    // Scheduled reminders and agenda circulation are sent by the timers only.
    if ((body.action || 'manual_missing_update_reminder') !== 'manual_missing_update_reminder') {
      throw new Error('Only missing-update reminders can be sent manually.');
    }

    if (!themeId) {
      throw new Error('themeId is required.');
    }

    const meetingDate = text(body.meetingDate);
    const payload = await buildThemeMeetingPlan({ meetingDate, validateUsers: true });
    if (!canManageTheme(payload.config, themeId, user)) {
      throw new AuthError('Only administrators, PIs, and the theme coordinator can send reminders.', 403, 'forbidden');
    }
    assertMeetingNotHeld(payload.config, themeId, payload.plan.meeting_date, user);
    if (payload.plan.meetings.find((meeting) => meeting.theme_id === themeId)?.cancelled) {
      throw new Error(`Theme ${themeId} meeting on ${payload.plan.meeting_date} has been cancelled.`);
    }
    if (submissionClosed(payload.config, payload.plan.meeting_date)) {
      throw new Error('Reminders can only be sent before the submission cutoff.');
    }

    const run = await buildThemeMeetingReminderRun('manual_missing_update_reminder', {
      meetingDate,
      themeId,
      validateUsers: true,
    });
    const emails = await sendThemeMeetingReminderEmails(run.notifications);

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
    });
  } catch (error) {
    return errorResponse(error, 400);
  }
}
