import 'dotenv/config';
import { NextResponse } from 'next/server';
import { AuthError, requireSessionUser } from '../../../../src/mastra/auth/session';
import { recordAuditLog } from '../../../../src/mastra/db/audit-log';
import { markThemeNotificationsRead } from '../../../../src/mastra/db/theme-notifications';
import { errorResponse } from '../../../../src/mastra/http/error-response';
import { visibleNotificationsForUser } from '../../../../src/mastra/theme-meetings/access';
import { buildThemeMeetingPlan } from '../../../../src/mastra/theme-meetings/planner';

export const runtime = 'nodejs';

export async function PATCH(request: Request) {
  try {
    const user = await requireSessionUser(request);
    const body = await request.json() as Record<string, unknown>;
    const id = typeof body.notificationId === 'string' ? body.notificationId.trim() : '';
    const date = typeof body.meetingDate === 'string' ? body.meetingDate : undefined;
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Choose a valid meeting date.');
    if (!id && body.all !== true) throw new Error('Choose a meeting notification to mark as read.');
    const { notifications, config, plan } = await buildThemeMeetingPlan({ meetingDate: date, validateUsers: true });
    const visible = visibleNotificationsForUser(notifications, config, user);
    const selected = body.all === true
      ? visible.filter((notification) => notification.meeting_date === plan.meeting_date)
      : visible.filter((notification) => notification.id === id);
    if (id && body.all !== true && !selected.length) throw new AuthError('Meeting notification not found.', 404, 'not_found');
    await markThemeNotificationsRead(user.id, selected.map((notification) => notification.id));
    await recordAuditLog({ actor: user, action: body.all === true ? 'theme_notification.mark_all_read' : 'theme_notification.mark_read', targetType: 'theme_notification', targetId: id || null, summary: 'User marked meeting notifications read.', metadata: { count: selected.length } });
    return NextResponse.json({ ok: true });
  } catch (error) { return errorResponse(error, 400); }
}
