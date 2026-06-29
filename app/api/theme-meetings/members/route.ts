import 'dotenv/config';
import { NextResponse } from 'next/server';
import { AuthError, requireSessionUser } from '../../../../src/mastra/auth/session';
import { recordAuditLog } from '../../../../src/mastra/db/audit-log';
import { canManageTheme } from '../../../../src/mastra/theme-meetings/access';
import { buildThemeMeetingPlan, updateThemeMeetingMember } from '../../../../src/mastra/theme-meetings/planner';

export const runtime = 'nodejs';

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function errorResponse(error: unknown, status = 500) {
  return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
}

export async function POST(request: Request) {
  try {
    const user = await requireSessionUser(request);
    const body = (await request.json()) as Record<string, unknown>;
    const themeId = text(body.themeId);
    const action = text(body.action);
    const userId = text(body.userId);
    const username = text(body.username);
    const meetingDate = text(body.meetingDate);

    if (!themeId || (action !== 'add' && action !== 'remove') || (!userId && !username)) {
      throw new Error('themeId, action, and userId or username are required.');
    }

    const payload = await buildThemeMeetingPlan({ meetingDate, validateUsers: true });
    if (!canManageTheme(payload.config, themeId, user)) {
      throw new AuthError('Only administrators, PIs, and the theme coordinator can manage theme members.', 403, 'forbidden');
    }

    const result = await updateThemeMeetingMember({
      themeId,
      action,
      userId,
      username,
      meetingDate,
    });

    await recordAuditLog({
      actor: user,
      action: `theme_meeting.member_${action}`,
      targetType: 'theme_meeting',
      targetId: themeId,
      summary: `Theme meeting member ${action === 'add' ? 'added' : 'removed'}.`,
      metadata: {
        meetingDate: meetingDate || null,
        memberUsername: result.user.username,
        memberUserId: result.user.id,
      },
    });
    return NextResponse.json({
      user: result.user,
      plan: result.plan,
    });
  } catch (error) {
    return errorResponse(error, error instanceof AuthError ? error.status : 400);
  }
}
