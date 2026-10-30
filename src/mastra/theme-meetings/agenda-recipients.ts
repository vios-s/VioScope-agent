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

/** Why an account receives a theme's agenda without subscribing: its members and coordinator only. PIs and administrators subscribe like anyone else. */
export function themeAgendaRequiredReason(config: ThemeMeetingConfig, themeId: string, username: string): 'member' | 'coordinator' | null {
  const theme = config.themes.find((candidate) => candidate.theme_id === themeId);
  const normalized = username.trim().toLowerCase();
  if (!theme || !normalized) return null;
  if ((theme.member_users || []).some((account) => account.trim().toLowerCase() === normalized)) return 'member';
  return (theme.coordinator_user || '').trim().toLowerCase() === normalized ? 'coordinator' : null;
}

export function isThemeAgendaSubscriptionRequired(config: ThemeMeetingConfig, themeId: string, username: string): boolean {
  return themeAgendaRequiredReason(config, themeId, username) !== null;
}

// Members and the coordinator receive their own theme's agenda; everyone else (PIs and administrators included) only by subscription.
export function themeAgendaRecipients(
  plan: ThemeMeetingPlan,
  subscriptions: ThemeAgendaSubscription[],
  themeId?: string,
): Map<string, ThemeMeetingPlan> {
  const meetings = plan.meetings.filter((meeting) => !meeting.cancelled && (!themeId || meeting.theme_id === themeId));
  const normalize = (value: string) => value.trim().toLowerCase();
  const recipients = new Map<string, ThemeMeetingPlan>();
  const add = (username: string, meeting: ThemeMeetingPlan['meetings'][number]) => {
    const key = normalize(username);
    if (!key) return;
    const recipient = recipients.get(key) || { ...plan, meetings: [] };
    if (!recipient.meetings.includes(meeting)) recipient.meetings.push(meeting);
    recipients.set(key, recipient);
  };
  for (const meeting of meetings) {
    for (const username of [meeting.coordinator_username || '', ...meeting.member_usernames]) add(username, meeting);
    for (const subscription of subscriptions) if (subscription.themeId === meeting.theme_id) add(subscription.username, meeting);
  }
  return recipients;
}
