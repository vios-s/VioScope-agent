import {
  readThemeMeetingConfig,
  readThemeMeetingNotifications,
  readThemeMeetingUpdates,
  saveThemeMeetingNotifications,
  saveThemeMeetingUpdate,
  type ThemeMeetingStoreOptions,
  writeThemeMeetingConfig,
} from './store';
import { getUserById, getUserByUsername, listUsersForAdmin, type AuthUser } from '../db/users';
import {
  themeMeetingNotificationSchema,
  themeMeetingPlanSchema,
  themeMeetingUpdateSchema,
  type ThemeMeetingConfig,
  type ThemeMeetingNotification,
  type ThemeMeetingPlan,
  type ThemeMeetingUpdate,
  type ThemeReminderAction,
  type ThemeUpdateType,
} from './schema';

const millisecondsPerDay = 24 * 60 * 60 * 1000;
const targetWeekday = 3; // Wednesday, UTC date math over YYYY-MM-DD.

export type BuildThemeMeetingPlanOptions = ThemeMeetingStoreOptions & {
  meetingDate?: string;
  now?: Date;
};

export type BuildThemeMeetingReminderRunOptions = BuildThemeMeetingPlanOptions & {
  themeId?: string;
};

export type SubmitThemeMeetingUpdateInput = ThemeMeetingStoreOptions & {
  meetingDate?: string;
  themeId: string;
  member: string;
  updateType: ThemeUpdateType;
  progressText: string;
  questions?: string;
  submittedVia?: ThemeMeetingUpdate['submitted_via'];
  now?: Date;
};

export type ThemeMeetingReminderRun = {
  action: ThemeReminderAction;
  plan: ThemeMeetingPlan;
  notifications: ThemeMeetingNotification[];
  markdown: string;
};

export type UpdateThemeMeetingMemberInput = ThemeMeetingStoreOptions & {
  themeId: string;
  userId?: string;
  username?: string;
  action: 'add' | 'remove';
  meetingDate?: string;
};

function parseDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(value: string, days: number): string {
  const date = parseDateOnly(value);
  date.setUTCDate(date.getUTCDate() + days);
  return dateOnly(date);
}

function daysBetween(start: string, end: string): number {
  return Math.floor((parseDateOnly(end).getTime() - parseDateOnly(start).getTime()) / millisecondsPerDay);
}

function modulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function localDateString(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function upcomingWednesday(now = new Date(), timezone = 'Europe/London'): string {
  const today = localDateString(now, timezone);
  const day = parseDateOnly(today).getUTCDay();
  return addDays(today, modulo(targetWeekday - day, 7));
}

export function cycleGroupForDate(config: ThemeMeetingConfig, meetingDate: string): string {
  const weekOffset = Math.floor(daysBetween(config.cycle.anchor_date, meetingDate) / 7);
  return config.cycle.rotation[modulo(weekOffset, config.cycle.rotation.length)];
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeUsername(value: string | null | undefined): string {
  return value ? value.trim().toLowerCase() : '';
}

async function userDirectory(): Promise<Map<string, Pick<AuthUser, 'username' | 'displayName' | 'aliases'>>> {
  try {
    const users = await listUsersForAdmin();
    return new Map(users.map((user) => [normalizeUsername(user.username), user]));
  } catch {
    return new Map();
  }
}

function memberEntries(
  theme: ThemeMeetingConfig['themes'][number],
  usersByUsername: Map<string, Pick<AuthUser, 'username' | 'displayName' | 'aliases'>>,
): Array<{ username?: string; displayName: string }> {
  if (theme.member_users?.length) {
    return theme.member_users.map((username, index) => {
      const user = usersByUsername.get(normalizeUsername(username));
      return {
        username: normalizeUsername(username),
        displayName: user?.displayName || theme.members[index] || username,
      };
    });
  }

  return theme.members.map((displayName) => ({ displayName }));
}

function coordinatorDisplayName(
  theme: ThemeMeetingConfig['themes'][number],
  usersByUsername: Map<string, Pick<AuthUser, 'username' | 'displayName'>>,
): string {
  return theme.coordinator_user
    ? usersByUsername.get(normalizeUsername(theme.coordinator_user))?.displayName || theme.coordinator
    : theme.coordinator;
}

function updateLookupKeys(update: Pick<ThemeMeetingUpdate, 'member' | 'member_username'>): string[] {
  return [
    update.member_username ? `u:${normalizeUsername(update.member_username)}` : '',
    update.member ? `n:${normalizeName(update.member)}` : '',
  ].filter(Boolean);
}

function entryLookupKeys(entry: { username?: string; displayName: string }): string[] {
  return [
    entry.username ? `u:${normalizeUsername(entry.username)}` : '',
    `n:${normalizeName(entry.displayName)}`,
  ].filter(Boolean);
}

function getUpdateForEntry(updateByMember: Map<string, ThemeMeetingUpdate>, entry: { username?: string; displayName: string }) {
  for (const key of entryLookupKeys(entry)) {
    const update = updateByMember.get(key);
    if (update) {
      return update;
    }
  }

  return undefined;
}

function canonicalMember(
  config: ThemeMeetingConfig,
  themeId: string,
  member: string,
  usersByUsername: Map<string, Pick<AuthUser, 'username' | 'displayName' | 'aliases'>>,
): { displayName: string; username?: string } {
  const theme = config.themes.find((candidate) => candidate.theme_id === themeId);
  if (!theme) {
    throw new Error(`Unknown theme: ${themeId}`);
  }

  const normalized = normalizeName(member);
  const normalizedUsername = normalizeUsername(member);
  const entries = memberEntries(theme, usersByUsername);
  const direct = entries.find(
    (candidate) => normalizeName(candidate.displayName) === normalized || candidate.username === normalizedUsername,
  );
  if (direct) {
    return direct;
  }

  const coordinatorNames = [theme.coordinator, theme.coordinator_user || '', ...theme.coordinator_aliases].map(normalizeName);
  if (coordinatorNames.includes(normalized) || normalizeUsername(theme.coordinator_user || '') === normalizedUsername) {
    const coordinatorUsername = theme.coordinator_user ? normalizeUsername(theme.coordinator_user) : undefined;
    const coordinatorFirst = normalizeName(theme.coordinator).split(' ')[0];
    return (
      entries.find((candidate) => candidate.username === coordinatorUsername) ||
      entries.find((candidate) => normalizeName(candidate.displayName).split(' ')[0] === coordinatorFirst) || {
        displayName: member.trim(),
      }
    );
  }

  const user = usersByUsername.get(normalizedUsername);
  return { displayName: user?.displayName || member.trim(), username: user?.username ? normalizeUsername(user.username) : undefined };
}

function updateDuration(config: ThemeMeetingConfig, updateType: ThemeUpdateType): number {
  return config.submission.update_types[updateType]?.duration_minutes ?? 0;
}

export async function buildThemeMeetingPlan(options: BuildThemeMeetingPlanOptions = {}): Promise<{
  configPath: string;
  updatesPath: string;
  notificationsPath: string;
  config: ThemeMeetingConfig;
  plan: ThemeMeetingPlan;
  notifications: ThemeMeetingNotification[];
}> {
  const { path: configPath, config } = await readThemeMeetingConfig(options);
  const { path: updatesPath, updates } = await readThemeMeetingUpdates(options);
  const { path: notificationsPath, notifications } = await readThemeMeetingNotifications(options);
  const usersByUsername = await userDirectory();
  const meetingDate = options.meetingDate || upcomingWednesday(options.now, config.timezone);
  const cycleGroup = cycleGroupForDate(config, meetingDate);
  const activeThemes = config.themes.filter((theme) => theme.cycle_group === cycleGroup);
  const generatedAt = (options.now || new Date()).toISOString();
  const relevantUpdates = updates.filter((update) => update.meeting_date === meetingDate);

  const plan = themeMeetingPlanSchema.parse({
    meeting_date: meetingDate,
    timezone: config.timezone,
    cycle_group: cycleGroup,
    generated_at: generatedAt,
    meetings: activeThemes.map((theme) => {
      const entries = memberEntries(theme, usersByUsername);
      const updateByMember = new Map(
        relevantUpdates
          .filter((update) => update.theme_id === theme.theme_id)
          .flatMap((update) => updateLookupKeys(update).map((key) => [key, update] as const)),
      );
      const submittedEntries = entries.filter((entry) => getUpdateForEntry(updateByMember, entry));
      const missingEntries = entries.filter((entry) => !getUpdateForEntry(updateByMember, entry));
      const nothingToReportEntries = entries.filter(
        (entry) => getUpdateForEntry(updateByMember, entry)?.update_type === 'nothing_to_report',
      );
      const agendaItems = entries
        .map((entry) => getUpdateForEntry(updateByMember, entry))
        .filter((update): update is ThemeMeetingUpdate => Boolean(update))
        .filter((update) => update.update_type !== 'nothing_to_report')
        .map((update) => ({
          meeting_date: update.meeting_date,
          theme_id: theme.theme_id,
          theme_title: theme.title,
          member: update.member,
          member_username: update.member_username,
          update_type: update.update_type,
          duration_minutes: updateDuration(config, update.update_type),
          progress_text: update.progress_text,
          questions: update.questions,
          submitted_at: update.submitted_at,
        }));
      const plannedMinutes = agendaItems.reduce((total, item) => total + item.duration_minutes, 0);

      return {
        theme_id: theme.theme_id,
        title: theme.title,
        time: theme.time,
        duration_minutes: theme.duration_minutes,
        coordinator: coordinatorDisplayName(theme, usersByUsername),
        coordinator_username: theme.coordinator_user ? normalizeUsername(theme.coordinator_user) : undefined,
        members: entries.map((entry) => entry.displayName),
        member_usernames: entries.map((entry) => entry.username || ''),
        submitted_members: submittedEntries.map((entry) => entry.displayName),
        submitted_member_usernames: submittedEntries.map((entry) => entry.username || ''),
        missing_members: missingEntries.map((entry) => entry.displayName),
        missing_member_usernames: missingEntries.map((entry) => entry.username || ''),
        nothing_to_report_members: nothingToReportEntries.map((entry) => entry.displayName),
        nothing_to_report_member_usernames: nothingToReportEntries.map((entry) => entry.username || ''),
        agenda_items: agendaItems,
        planned_minutes: plannedMinutes,
        overbooked: plannedMinutes > theme.duration_minutes,
      };
    }),
  });

  return { configPath, updatesPath, notificationsPath, config, plan, notifications };
}

export async function submitThemeMeetingUpdate(input: SubmitThemeMeetingUpdateInput): Promise<{
  update: ThemeMeetingUpdate;
  plan: ThemeMeetingPlan;
}> {
  const { config } = await readThemeMeetingConfig(input);
  const usersByUsername = await userDirectory();
  const meetingDate = input.meetingDate || upcomingWednesday(input.now, config.timezone);
  const member = canonicalMember(config, input.themeId, input.member, usersByUsername);
  const questions = input.questions?.trim() || '';
  const updateTypeConfig = config.submission.update_types[input.updateType];

  if (updateTypeConfig?.questions_required && !questions) {
    throw new Error('Questions are required for short updates and deep dives.');
  }

  const update = themeMeetingUpdateSchema.parse({
    meeting_date: meetingDate,
    theme_id: input.themeId,
    member: member.displayName,
    member_username: member.username,
    update_type: input.updateType,
    progress_text: input.progressText,
    questions,
    submitted_at: (input.now || new Date()).toISOString(),
    submitted_via: input.submittedVia || 'api',
  });

  await saveThemeMeetingUpdate(update, input);
  const { plan } = await buildThemeMeetingPlan({ ...input, meetingDate });
  return { update, plan };
}

function notificationBody(action: ThemeReminderAction, member: string, themeId: string): string {
  if (action === 'agenda_cutoff') {
    return `${member} has no submitted update for Theme ${themeId}; they will not be planned into the agenda.`;
  }

  if (action === 'gentle_missing_update_reminder' || action === 'manual_missing_update_reminder') {
    return `${member}, please add your Theme ${themeId} update before Wednesday 08:00.`;
  }

  return `${member}, please add your Theme ${themeId} progress update for this week's meeting.`;
}

export async function buildThemeMeetingReminderRun(
  action: ThemeReminderAction,
  options: BuildThemeMeetingReminderRunOptions = {},
): Promise<ThemeMeetingReminderRun> {
  const { plan } = await buildThemeMeetingPlan(options);
  const createdAt = (options.now || new Date()).toISOString();
  const meetings = options.themeId
    ? plan.meetings.filter((meeting) => meeting.theme_id === options.themeId)
    : plan.meetings;

  if (options.themeId && !meetings.length) {
    throw new Error(`Theme ${options.themeId} is not active on ${plan.meeting_date}.`);
  }

  const notifications = meetings.flatMap((meeting) => {
    const members =
      action === 'first_reminder'
        ? meeting.members.map((member, index) => ({ member, username: meeting.member_usernames[index] || undefined }))
        : meeting.missing_members.map((member, index) => ({
            member,
            username: meeting.missing_member_usernames[index] || undefined,
          }));

    return members.map(({ member, username }) =>
      themeMeetingNotificationSchema.parse({
        id: `${action}:${plan.meeting_date}:${meeting.theme_id}:${(username || normalizeName(member)).replace(/\s+/g, '-')}`,
        action,
        meeting_date: plan.meeting_date,
        cycle_group: plan.cycle_group,
        theme_id: meeting.theme_id,
        member,
        member_username: username,
        title:
          action === 'agenda_cutoff'
            ? `Theme ${meeting.theme_id} agenda cutoff`
            : `Theme ${meeting.theme_id} update reminder`,
        body: notificationBody(action, member, meeting.theme_id),
        created_at: createdAt,
        read: false,
      }),
    );
  });

  await saveThemeMeetingNotifications(notifications, options);
  return {
    action,
    plan,
    notifications,
    markdown: renderReminderRun(action, plan, notifications),
  };
}

export async function updateThemeMeetingMember(input: UpdateThemeMeetingMemberInput): Promise<{
  user: AuthUser;
  plan: ThemeMeetingPlan;
  config: ThemeMeetingConfig;
}> {
  const { path: configPath, config } = await readThemeMeetingConfig(input);
  const user = input.userId
    ? await getUserById(input.userId)
    : input.username
      ? await getUserByUsername(input.username)
      : null;

  if (!user) {
    throw new Error('User not found.');
  }

  const theme = config.themes.find((candidate) => candidate.theme_id === input.themeId);
  if (!theme) {
    throw new Error(`Unknown theme: ${input.themeId}`);
  }

  const username = normalizeUsername(user.username);
  const usersByUsername = await userDirectory();
  usersByUsername.set(username, user);
  const existingUsernames = theme.member_users?.length
    ? theme.member_users.map(normalizeUsername)
    : memberEntries(theme, usersByUsername).map((entry) => entry.username).filter((value): value is string => Boolean(value));
  const nextUsernames =
    input.action === 'add'
      ? [...new Set([...existingUsernames, username])]
      : existingUsernames.filter((candidate) => candidate !== username);

  if (input.action === 'remove' && normalizeUsername(theme.coordinator_user) === username) {
    throw new Error('Cannot remove the theme coordinator from their own theme.');
  }

  theme.member_users = nextUsernames;
  theme.members = nextUsernames.map((nextUsername) => usersByUsername.get(nextUsername)?.displayName || nextUsername);
  await writeThemeMeetingConfig(config, { configPath });
  const { plan } = await buildThemeMeetingPlan({ ...input, meetingDate: input.meetingDate });
  return { user, plan, config };
}

export function renderThemeMeetingPlan(plan: ThemeMeetingPlan): string {
  const meetings = plan.meetings
    .map((meeting) => {
      const agenda = meeting.agenda_items.length
        ? meeting.agenda_items
            .map(
              (item) =>
                `  - ${item.member}: ${item.update_type} (${item.duration_minutes} min) - ${item.progress_text}${
                  item.questions ? ` Questions: ${item.questions}` : ''
                }`,
            )
            .join('\n')
        : '  - No planned updates yet';

      return `## Theme ${meeting.theme_id} - ${meeting.title} (${meeting.time}, ${meeting.duration_minutes} min)
- Coordinator: ${meeting.coordinator}
- Submitted: ${meeting.submitted_members.length}/${meeting.members.length}
- Planned minutes: ${meeting.planned_minutes}/${meeting.duration_minutes}${meeting.overbooked ? ' (overbooked)' : ''}
- Missing: ${meeting.missing_members.join(', ') || 'none'}
- Nothing to report: ${meeting.nothing_to_report_members.join(', ') || 'none'}

Agenda:
${agenda}`;
    })
    .join('\n\n');

  return `# Theme Meeting Plan

- Date: ${plan.meeting_date}
- Cycle group: ${plan.cycle_group}
- Timezone: ${plan.timezone}

${meetings}
`;
}

function renderReminderRun(
  action: ThemeReminderAction,
  plan: ThemeMeetingPlan,
  notifications: ThemeMeetingNotification[],
): string {
  return `# Theme Meeting Cron

- Action: ${action}
- Meeting date: ${plan.meeting_date}
- Cycle group: ${plan.cycle_group}
- Notifications: ${notifications.length}

${renderThemeMeetingPlan(plan)}`;
}
