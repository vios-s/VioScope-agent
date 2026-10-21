import { canSeeAll } from '../auth/session';
import type { AuthUser } from '../db/users';
import type { ThemeMeetingConfig, ThemeMeetingNotification, ThemeMeetingPlan } from './schema';

function themeById(config: ThemeMeetingConfig, themeId: string) {
  return config.themes.find((theme) => theme.theme_id === themeId);
}

function normalizeUsername(value: string | null | undefined): string {
  return value ? value.trim().toLowerCase() : '';
}

export function canManageTheme(config: ThemeMeetingConfig, themeId: string, user: AuthUser): boolean {
  if (canSeeAll(user)) {
    return true;
  }

  const theme = themeById(config, themeId);
  return Boolean(theme && normalizeUsername(theme.coordinator_user) === normalizeUsername(user.username));
}

export function managedThemeIdsForUser(plan: ThemeMeetingPlan, config: ThemeMeetingConfig, user: AuthUser): string[] {
  return plan.meetings
    .filter((meeting) => canManageTheme(config, meeting.theme_id, user))
    .map((meeting) => meeting.theme_id);
}

export function visiblePlanForUser(plan: ThemeMeetingPlan, config: ThemeMeetingConfig, user: AuthUser): ThemeMeetingPlan {
  if (canSeeAll(user)) {
    return plan;
  }

  return {
    ...plan,
    meetings: plan.meetings
      .map((meeting) => {
        if (canManageTheme(config, meeting.theme_id, user)) {
          return meeting;
        }

        const members = meeting.members.filter(
          (member, index) =>
            normalizeUsername(meeting.member_usernames[index]) === normalizeUsername(user.username),
        );
        const agendaItems = meeting.agenda_items.filter(
          (item) => normalizeUsername(item.member_username) === normalizeUsername(user.username),
        );
        return {
          ...meeting,
          members,
          member_usernames: meeting.member_usernames.filter(
            (username, index) => normalizeUsername(username) === normalizeUsername(user.username),
          ),
          submitted_members: meeting.submitted_members.filter(
            (member, index) =>
              normalizeUsername(meeting.submitted_member_usernames[index]) === normalizeUsername(user.username),
          ),
          submitted_member_usernames: meeting.submitted_member_usernames.filter(
            (username, index) =>
              normalizeUsername(username) === normalizeUsername(user.username),
          ),
          missing_members: meeting.missing_members.filter(
            (member, index) =>
              normalizeUsername(meeting.missing_member_usernames[index]) === normalizeUsername(user.username),
          ),
          missing_member_usernames: meeting.missing_member_usernames.filter(
            (username, index) =>
              normalizeUsername(username) === normalizeUsername(user.username),
          ),
          agenda_items: agendaItems,
          planned_minutes: agendaItems.reduce((total, item) => total + item.duration_minutes, 0),
        };
      })
      .filter((meeting) => meeting.members.length || meeting.agenda_items.length),
  };
}

export function visibleNotificationsForUser(
  notifications: ThemeMeetingNotification[],
  config: ThemeMeetingConfig,
  user: AuthUser,
): ThemeMeetingNotification[] {
  return canSeeAll(user)
    ? notifications
    : notifications.filter(
        (notification) =>
          canManageTheme(config, notification.theme_id, user) ||
          normalizeUsername(notification.member_username) === normalizeUsername(user.username),
      );
}
