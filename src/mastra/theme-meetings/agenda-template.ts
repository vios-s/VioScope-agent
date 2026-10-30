import type { ThemeMeetingAgendaItem } from './schema';

const rank = { triage_admin: 0, deep_dive: 1, short_update: 2, nothing_to_report: 3, assignments: 4 };
export const compareAgendaItems = (a: ThemeMeetingAgendaItem, b: ThemeMeetingAgendaItem) =>
  rank[a.update_type] - rank[b.update_type] || b.duration_minutes - a.duration_minutes;

/** Reserved keys cannot be account usernames. These rows never represent member submissions. */
export function defaultAgenda(items: ThemeMeetingAgendaItem[], meetingDate: string, themeId: string, title: string): ThemeMeetingAgendaItem[] {
  const placeholder = (type: 'triage_admin' | 'assignments', name: string, guidance: string): ThemeMeetingAgendaItem => ({
    meeting_date: meetingDate, theme_id: themeId, theme_title: title, member: name, member_username: `:${type}`,
    update_type: type, duration_minutes: 5, progress_text: guidance, questions: '',
    // Stable across reads so a regenerated placeholder never invalidates an unchanged agenda.
    submitted_at: `${meetingDate}T00:00:00.000Z`,
  });
  return [
    placeholder('triage_admin', 'Triage & Admin', 'PI reviews the dashboard, confirms the Deep Dive slot and shares brief lab announcements.'),
    ...items.slice().sort(compareAgendaItems),
    placeholder('assignments', 'Assignments', 'Record the Deep Dive decision (Proceed / Pivot / Kill) and assign the Discussant and Deep Dive slot for the following week.'),
  ];
}
