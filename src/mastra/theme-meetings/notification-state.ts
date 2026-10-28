import { isUserName } from '../auth/session';
import type { AuthUser } from '../db/users';
import type { ThemeMeetingNotification, ThemeMeetingPlan } from './schema';

export function notificationStateForUser(
  notifications: ThemeMeetingNotification[],
  plan: ThemeMeetingPlan,
  user: AuthUser,
  readIds: Set<string>,
): ThemeMeetingNotification[] {
  return notifications.map((notification) => {
    const ownReminder = notification.action !== 'agenda_cutoff' && (
      notification.member_username
        ? notification.member_username.trim().toLowerCase() === user.username.trim().toLowerCase()
        : isUserName(notification.member, user)
    );
    const completed = ownReminder && notification.meeting_date === plan.meeting_date && plan.meetings.some((meeting) =>
      !meeting.cancelled && meeting.theme_id === notification.theme_id && meeting.submitted_member_usernames.some(
        (username) => username.trim().toLowerCase() === user.username.trim().toLowerCase(),
      ),
    );
    return { ...notification, read: readIds.has(notification.id) || completed, completed };
  });
}
