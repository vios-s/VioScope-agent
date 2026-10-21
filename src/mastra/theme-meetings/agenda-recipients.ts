import type { ThemeAgendaSubscription } from '../db/theme-agenda-subscriptions';
import type { ThemeMeetingConfig, ThemeMeetingPlan } from './schema';

export function themeAgendaPreviewRecipients(plan: ThemeMeetingPlan, themeId?: string): Map<string, ThemeMeetingPlan> {
  const recipients = new Map<string, ThemeMeetingPlan>();
  for (const meeting of plan.meetings.filter((meeting) => !meeting.cancelled && (!themeId || meeting.theme_id === themeId))) {
    for (const username of new Set(meeting.member_usernames.map((member) => member.trim().toLowerCase()).filter(Boolean))) {
      const recipient = recipients.get(username) || { ...plan, meetings: [] };
      recipient.meetings.push(meeting);
      recipients.set(username, recipient);
    }
  }
  return recipients;
}

export function isThemeAgendaSubscriptionRequired(config: ThemeMeetingConfig, themeId: string, username: string): boolean {
  const theme = config.themes.find((candidate) => candidate.theme_id === themeId);
  if (!theme) return false;
  const normalized = username.trim().toLowerCase();
  return [...config.pi_users, config.administrator_user || '', theme.coordinator_user || '', ...(theme.member_users || [])]
    .some((account) => account.trim().toLowerCase() === normalized);
}

export function themeAgendaRecipients(
  plan: ThemeMeetingPlan,
  config: ThemeMeetingConfig,
  subscriptions: ThemeAgendaSubscription[],
  themeId?: string,
): Map<string, ThemeMeetingPlan> {
  const meetings = plan.meetings.filter((meeting) => !meeting.cancelled && (!themeId || meeting.theme_id === themeId));
  const recipients = new Map<string, ThemeMeetingPlan>();
  const normalize = (value: string) => value.trim().toLowerCase();
  const leaders = new Set([...config.pi_users, config.administrator_user || ''].map(normalize).filter(Boolean));
  const usernames = new Set([
    ...leaders,
    ...meetings.flatMap((meeting) => [meeting.coordinator_username || '', ...meeting.member_usernames]),
    ...subscriptions.filter((subscription) => meetings.some((meeting) => meeting.theme_id === subscription.themeId)).map((subscription) => subscription.username),
  ].map(normalize).filter(Boolean));

  for (const username of usernames) {
    const visibleMeetings = meetings.filter((meeting) =>
      leaders.has(username) || normalize(meeting.coordinator_username || '') === username ||
      meeting.member_usernames.some((member) => normalize(member) === username) ||
      subscriptions.some((subscription) => normalize(subscription.username) === username && subscription.themeId === meeting.theme_id),
    );
    if (visibleMeetings.length) recipients.set(username, { ...plan, meetings: visibleMeetings });
  }
  return recipients;
}
