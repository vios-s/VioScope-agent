import 'dotenv/config';
import { NextResponse } from 'next/server';
import { AuthError, requireSessionUser } from '../../../../src/mastra/auth/session';
import { recordAuditLog } from '../../../../src/mastra/db/audit-log';
import { canManageTheme } from '../../../../src/mastra/theme-meetings/access';
import { buildThemeMeetingPlan, cancelThemeMeeting } from '../../../../src/mastra/theme-meetings/planner';
import { removeThemeMeetingCancellation } from '../../../../src/mastra/theme-meetings/store';

export const runtime = 'nodejs';

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function errorResponse(error: unknown, status = 500) {
  return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
}

async function requestDetails(request: Request) {
  const user = await requireSessionUser(request);
  const body = (await request.json()) as Record<string, unknown>;
  const themeId = text(body.themeId);
  if (!themeId) throw new Error('themeId is required.');

  const before = await buildThemeMeetingPlan({ meetingDate: text(body.meetingDate), validateUsers: true });
  if (!canManageTheme(before.config, themeId, user)) {
    throw new AuthError('Only administrators, PIs, and the theme coordinator can cancel this meeting.', 403, 'forbidden');
  }
  if (!before.plan.meetings.some((meeting) => meeting.theme_id === themeId)) {
    throw new Error(`Theme ${themeId} is not active on ${before.plan.meeting_date}.`);
  }

  return { user, themeId, meetingDate: before.plan.meeting_date, reason: text(body.reason) };
}

export async function POST(request: Request) {
  try {
    const { user, themeId, meetingDate, reason } = await requestDetails(request);
    const cancellation = await cancelThemeMeeting({
      meetingDate,
      themeId,
      cancelledByUsername: user.username,
      reason,
    });
    const payload = await buildThemeMeetingPlan({ meetingDate, validateUsers: true });
    await recordAuditLog({
      actor: user,
      action: 'theme_meeting.cancel',
      targetType: 'theme_meeting',
      targetId: themeId,
      summary: 'Theme meeting cancelled.',
      metadata: { meetingDate, reason: cancellation.reason || null },
    });
    return NextResponse.json({ cancellation, plan: payload.plan });
  } catch (error) {
    return errorResponse(error, error instanceof AuthError ? error.status : 400);
  }
}

export async function DELETE(request: Request) {
  try {
    const { user, themeId, meetingDate } = await requestDetails(request);
    await removeThemeMeetingCancellation(meetingDate, themeId);
    const payload = await buildThemeMeetingPlan({ meetingDate, validateUsers: true });
    await recordAuditLog({
      actor: user,
      action: 'theme_meeting.restore',
      targetType: 'theme_meeting',
      targetId: themeId,
      summary: 'Theme meeting cancellation reversed.',
      metadata: { meetingDate },
    });
    return NextResponse.json({ plan: payload.plan });
  } catch (error) {
    return errorResponse(error, error instanceof AuthError ? error.status : 400);
  }
}
