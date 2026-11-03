import 'dotenv/config';
import { NextResponse } from 'next/server';
import { requireSessionUser } from '../../../../src/mastra/auth/session';
import { errorResponse } from '../../../../src/mastra/http/error-response';
import { recordAuditLog } from '../../../../src/mastra/db/audit-log';
import { visiblePlanForUser } from '../../../../src/mastra/theme-meetings/access';
import { updateThemeMeetingMember } from '../../../../src/mastra/theme-meetings/planner';

export const runtime = 'nodejs';

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
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

    const result = await updateThemeMeetingMember({
      actor: user,
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
      user: { id: result.user.id, username: result.user.username, displayName: result.user.displayName },
      plan: visiblePlanForUser(result.plan, result.config, user),
    });
  } catch (error) {
    return errorResponse(error, 400);
  }
}
