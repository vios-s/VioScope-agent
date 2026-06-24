import 'dotenv/config';
import { NextResponse } from 'next/server';
import { AuthError, canSeeAll, isUserName, requireSessionUser } from '../../../src/mastra/auth/session';
import { listUsersForAdmin, type AuthUser } from '../../../src/mastra/db/users';
import {
  managedThemeIdsForUser,
  visibleNotificationsForUser,
  visiblePlanForUser,
} from '../../../src/mastra/theme-meetings/access';
import { buildThemeMeetingPlan } from '../../../src/mastra/theme-meetings/planner';
import type { ThemeMeetingNotification, ThemeMeetingPlan } from '../../../src/mastra/theme-meetings/schema';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function dateOffset(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function normalizeUsername(value: string | null | undefined): string {
  return value ? value.trim().toLowerCase() : '';
}

function summarizePlan(plan: ThemeMeetingPlan) {
  return {
    meeting_date: plan.meeting_date,
    timezone: plan.timezone,
    cycle_group: plan.cycle_group,
    generated_at: plan.generated_at,
    meetings: plan.meetings.map((meeting) => ({
      theme_id: meeting.theme_id,
      title: meeting.title,
      time: meeting.time,
      duration_minutes: meeting.duration_minutes,
      coordinator: meeting.coordinator,
      member_count: meeting.members.length,
      submitted_count: meeting.submitted_members.length,
      planned_minutes: meeting.planned_minutes,
      agenda_count: meeting.agenda_items.length,
      overbooked: meeting.overbooked,
    })),
  };
}

function hasOwnMemberRow(plan: ThemeMeetingPlan, user: AuthUser): boolean {
  return plan.meetings.some((meeting) =>
    meeting.members.some(
      (member, index) => normalizeUsername(meeting.member_usernames[index]) === normalizeUsername(user.username) || isUserName(member, user),
    ),
  );
}

function errorResponse(error: unknown, status = 500) {
  return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
}

function notificationAllowed(notification: ThemeMeetingNotification, user: AuthUser): boolean {
  if (notification.action === 'agenda_cutoff') {
    return user.notificationPreferences.theme_meeting_reminders.web;
  }
  return user.notificationPreferences.project_progress_reminders.web;
}

export async function GET(request: Request) {
  try {
    const user = await requireSessionUser(request);
    const url = new URL(request.url);
    const meetingDate = url.searchParams.get('date') || undefined;
    const payload = await buildThemeMeetingPlan({ meetingDate });
    const visiblePlan = visiblePlanForUser(payload.plan, payload.config, user);
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
    const pastPlans = await Promise.all(
      [7, 14, 21].map(async (daysBack) => {
        const past = await buildThemeMeetingPlan({ meetingDate: dateOffset(payload.plan.meeting_date, -daysBack) });
        return summarizePlan(past.plan);
      }),
    );
    let submissionPlan: ThemeMeetingPlan | null = null;
    if (!canSeeAll(user)) {
      for (let week = 0; week < 8; week += 1) {
        const candidate = week === 0 ? payload : await buildThemeMeetingPlan({ meetingDate: dateOffset(payload.plan.meeting_date, week * 7) });
        const visibleCandidate = visiblePlanForUser(candidate.plan, candidate.config, user);
        if (hasOwnMemberRow(visibleCandidate, user)) {
          submissionPlan = visibleCandidate;
          break;
        }
      }
    }
    return NextResponse.json({
      plan: visiblePlan,
      overviewPlan: summarizePlan(payload.plan),
      submissionPlan,
      pastPlans,
      notifications: visibleNotificationsForUser(currentNotifications, payload.config, user).filter((notification) =>
        notificationAllowed(notification, user),
      ),
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
