import 'dotenv/config';
import { NextResponse } from 'next/server';
import { AuthError, requireSessionUser } from '../../../src/mastra/auth/session';
import { listUsersForAdmin } from '../../../src/mastra/db/users';
import {
  managedThemeIdsForUser,
  visibleNotificationsForUser,
  visiblePlanForUser,
} from '../../../src/mastra/theme-meetings/access';
import { buildThemeMeetingPlan } from '../../../src/mastra/theme-meetings/planner';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function errorResponse(error: unknown, status = 500) {
  return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
}

export async function GET(request: Request) {
  try {
    const user = await requireSessionUser(request);
    const url = new URL(request.url);
    const meetingDate = url.searchParams.get('date') || undefined;
    const payload = await buildThemeMeetingPlan({ meetingDate });
    const managedThemeIds = managedThemeIdsForUser(payload.plan, payload.config, user);
    const users = managedThemeIds.length
      ? (await listUsersForAdmin()).map((nextUser) => ({
          id: nextUser.id,
          username: nextUser.username,
          displayName: nextUser.displayName,
          role: nextUser.role,
          provisioningStatus: nextUser.provisioningStatus,
        }))
      : [];
    const currentNotifications = payload.notifications.filter(
      (notification) => notification.meeting_date === payload.plan.meeting_date,
    );
    return NextResponse.json({
      plan: visiblePlanForUser(payload.plan, payload.config, user),
      notifications: visibleNotificationsForUser(currentNotifications, payload.config, user),
      access: {
        canManageThemeIds: managedThemeIds,
      },
      users,
      source: payload.configPath.includes('/fixtures/') ? 'fixture' : 'configured',
      paths: {
        config: payload.configPath,
        updates: payload.updatesPath,
        notifications: payload.notificationsPath,
      },
    });
  } catch (error) {
    return errorResponse(error, error instanceof AuthError ? error.status : 500);
  }
}
