import 'dotenv/config';
import { NextResponse } from 'next/server';
import { AuthError, requireSessionUser } from '../../../src/mastra/auth/session';
import { recordAuditLog } from '../../../src/mastra/db/audit-log';
import { listChatNotificationsForUser, markChatNotificationsRead } from '../../../src/mastra/db/chat';

export const runtime = 'nodejs';

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function errorResponse(error: unknown, status = 500) {
  return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
}

export async function GET(request: Request) {
  try {
    const user = await requireSessionUser(request);
    return NextResponse.json({ notifications: await listChatNotificationsForUser(user.id) });
  } catch (error) {
    return errorResponse(error, error instanceof AuthError ? error.status : 500);
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireSessionUser(request);
    const body = (await request.json()) as Record<string, unknown>;
    const notificationId = text(body.notificationId);
    const all = body.all === true;
    const notifications = await markChatNotificationsRead({
      userId: user.id,
      notificationId,
      all,
    });
    await recordAuditLog({
      actor: user,
      action: all ? 'notification.mark_all_read' : 'notification.mark_read',
      targetType: 'notification',
      targetId: notificationId || null,
      summary: all ? 'User marked all notifications read.' : 'User marked notification read.',
      metadata: { unreadRemaining: notifications.filter((notification) => !notification.readAt).length },
    });
    return NextResponse.json({
      notifications,
    });
  } catch (error) {
    return errorResponse(error, error instanceof AuthError ? error.status : 400);
  }
}
