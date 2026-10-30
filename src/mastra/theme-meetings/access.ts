import { isAgendaPlaceholder } from './schema';
import { AuthError, canSeeAll } from '../auth/session';
import type { AuthUser } from '../db/users';
import { coordinatorEditWindowOpen, nextThemeMeetingDate } from './planner';
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

/** True when a coordinator (theme manager without PI/admin rights) views a meeting before the theme's current/next meeting
 * after its edit window (16:00 on the following Friday) has closed. */
export function isPastMeetingReadOnly(config: ThemeMeetingConfig, themeId: string, meetingDate: string, user: AuthUser, now = new Date()): boolean {
  if (canSeeAll(user) || !canManageTheme(config, themeId, user)) return false;
  const current = nextThemeMeetingDate(config, themeId, now);
  return Boolean(current && meetingDate < current && !coordinatorEditWindowOpen(config, meetingDate, now));
}

export function assertMeetingWritable(config: ThemeMeetingConfig, themeId: string, meetingDate: string, user: AuthUser): void {
  if (isPastMeetingReadOnly(config, themeId, meetingDate, user)) {
    throw new AuthError('Coordinators can change a meeting until 16:00 on the Friday after it.', 403, 'forbidden');
  }
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
          (item) => (members.length > 0 && isAgendaPlaceholder(item)) || normalizeUsername(item.member_username) === normalizeUsername(user.username),
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

const memberReminderActions = new Set<ThemeMeetingNotification['action']>([
  'first_reminder',
  'gentle_missing_update_reminder',
  'manual_missing_update_reminder',
]);

// Reminders are addressed to one member (exact users.username) and visible only to that member.
// Broadcast notifications (agenda cutoff) keep the addressed member plus theme managers.
export function visibleNotificationsForUser(
  notifications: ThemeMeetingNotification[],
  config: ThemeMeetingConfig,
  user: AuthUser,
): ThemeMeetingNotification[] {
  return notifications.flatMap((notification) => {
    if (normalizeUsername(notification.member_username) === normalizeUsername(user.username)) return [notification];
    if (memberReminderActions.has(notification.action) || !canManageTheme(config, notification.theme_id, user)) return [];
    // The stored cutoff text addresses the member ("You have…"); managers read it about that member.
    return [notification.action === 'agenda_cutoff'
      ? { ...notification, body: `${notification.member} has no project progress update for Theme ${notification.theme_id}. Their item will not be planned into the agenda.` }
      : notification];
  });
}

export type ThemeReminderStatus = {
  theme_id: string;
  member_username: string;
  action: ThemeMeetingNotification['action'];
  sent_at: string;
};

// Manager-only summary: the latest reminder per member of a managed theme, without notification bodies.
export function reminderStatusForManager(
  notifications: ThemeMeetingNotification[],
  config: ThemeMeetingConfig,
  user: AuthUser,
): ThemeReminderStatus[] {
  const latest = new Map<string, ThemeReminderStatus>();
  for (const notification of notifications) {
    const username = normalizeUsername(notification.member_username);
    if (!username || !memberReminderActions.has(notification.action) || !canManageTheme(config, notification.theme_id, user)) continue;
    const key = `${notification.theme_id}:${username}`;
    const current = latest.get(key);
    if (!current || notification.created_at > current.sent_at) {
      latest.set(key, { theme_id: notification.theme_id, member_username: username, action: notification.action, sent_at: notification.created_at });
    }
  }
  return [...latest.values()];
}
