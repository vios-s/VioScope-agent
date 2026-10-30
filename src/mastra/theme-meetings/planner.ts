import { withFileLock } from '../atomic-file';
import { formatMeetingProject } from './project-context';
import {
  claimThemeMeetingEmailDelivery,
  hasThemeMeetingEmailDeliveryClaim,
  readThemeMeetingCancellations,
  readThemeMeetingConfig,
  readThemeMeetingEmailDeliveries,
  readThemeMeetingNotifications,
  readThemeMeetingUpdates,
  releaseThemeMeetingEmailDeliveryClaim,
  saveThemeMeetingEmailDelivery,
  saveThemeMeetingCancellation,
  saveThemeMeetingNotifications,
  saveThemeMeetingUpdate,
  type ThemeMeetingStoreOptions,
  writeThemeMeetingConfig,
} from './store';
import { getUserById, getUserByUsername, listUsersForAdmin, type AuthUser } from '../db/users';
import { notificationEmailEnabled, registeredNotificationEmail, sendNotificationEmail } from '../email';
import { renderThemeMeetingAgendaEmail, type ConfirmedAgendaEmail } from './agenda-email';
import { defaultAgenda } from './agenda-template';
import { themeAgendaTypeLabels } from './schema';
import { listThemeAgendaSubscriptions } from '../db/theme-agenda-subscriptions';
import { themeAgendaPreviewRecipients, themeAgendaRecipients } from './agenda-recipients';
import {
  themeUpdateTypeLabels,
  themeMeetingNotificationSchema,
  themeMeetingPlanSchema,
  themeMeetingUpdateSchema,
  type ThemeMeetingConfig,
  type ThemeMeetingCancellation,
  type ThemeMeetingNotification,
  type ThemeMeetingPlan,
  type ThemeMeetingUpdate,
  type ThemeReminderAction,
  type ThemeUpdateType,
} from './schema';

import { applyConfirmedAgendas, latestConfirmation, meetingDateSchema, readMeetingWorkflow } from './workflow';
import { formatDay, formatLongDay } from '../../../app/format';

const millisecondsPerDay = 24 * 60 * 60 * 1000;
const targetWeekday = 3; // Wednesday, UTC date math over YYYY-MM-DD.
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

export type BuildThemeMeetingPlanOptions = ThemeMeetingStoreOptions & {
  rawAgenda?: boolean;
  meetingDate?: string;
  now?: Date;
  validateUsers?: boolean;
};

export type BuildThemeMeetingReminderRunOptions = BuildThemeMeetingPlanOptions & {
  themeId?: string;
  previewOnly?: boolean;
};

export type SubmitThemeMeetingUpdateInput = ThemeMeetingStoreOptions & {
  meetingDate?: string;
  themeId: string;
  member: string;
  updateType: ThemeUpdateType;
  progressText?: string;
  questions?: string;
  submittedVia?: ThemeMeetingUpdate['submitted_via'];
  projectContext?: ThemeMeetingUpdate['project_context'];
  now?: Date;
  validateUsers?: boolean;
};

export type CancelThemeMeetingInput = ThemeMeetingStoreOptions & {
  meetingDate: string;
  themeId: string;
  cancelledByUsername: string;
  reason?: string;
  now?: Date;
};

export type ThemeMeetingReminderRun = {
  action: ThemeReminderAction;
  config: ThemeMeetingConfig;
  plan: ThemeMeetingPlan;
  notifications: ThemeMeetingNotification[];
  markdown: string;
};

export type ThemeMeetingReminderEmailResult = {
  sent: number;
  skipped: number;
  failed: number;
};

export type ThemeMeetingAgendaEmailOptions = {
  themeId?: string;
  phase?: 'preview' | 'final';
  /** Circulates a human-confirmed version; deliveries are deduplicated per version and recipient. */
  confirmation?: ConfirmedAgendaEmail;
} & ThemeMeetingStoreOptions;

export function confirmedAgendaDeliveryPrefix(meetingDate: string, themeId: string, version: number): string {
  return `theme-agenda-confirmed:${meetingDate}:${themeId}:v${version}:`;
}

export type UpdateThemeMeetingMemberInput = ThemeMeetingStoreOptions & {
  themeId: string;
  userId?: string;
  username?: string;
  action: 'add' | 'remove';
  meetingDate?: string;
};

function meetingKey(meetingDate: string, themeId: string): string {
  return `${meetingDate}:${normalizeUsername(themeId)}`;
}

async function sendClaimedThemeMeetingEmail(
  deliveryId: string,
  email: { to: string | null | undefined; subject: string; text: string; html?: string },
  options: ThemeMeetingStoreOptions,
): Promise<boolean> {
  if (!(await claimThemeMeetingEmailDelivery(deliveryId, options))) return false;

  let sent = false;
  try {
    sent = await sendNotificationEmail(email);
  } catch (error) {
    await releaseThemeMeetingEmailDeliveryClaim(deliveryId, options);
    throw error;
  }

  if (!sent) {
    await releaseThemeMeetingEmailDeliveryClaim(deliveryId, options);
    return false;
  }

  try {
    await saveThemeMeetingEmailDelivery({ id: deliveryId, sent_at: new Date().toISOString() }, options);
  } catch (error) {
    console.warn('Could not record theme meeting email delivery:', error);
  }

  return true;
}

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

function localDateTimeString(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

export function upcomingWednesday(now = new Date(), timezone = 'Europe/London'): string {
  const today = localDateString(now, timezone);
  const day = parseDateOnly(today).getUTCDay();
  return addDays(today, modulo(targetWeekday - day, 7));
}

/** Coordinators may still change a meeting until 16:00 (theme timezone) on the Friday after it. */
export function coordinatorEditWindowOpen(config: ThemeMeetingConfig, meetingDate: string, now = new Date()): boolean {
  const friday = addDays(meetingDate, modulo(5 - parseDateOnly(meetingDate).getUTCDay(), 7));
  return localDateTimeString(now, config.timezone) < `${friday}T16:00`;
}

export function cycleGroupForDate(config: ThemeMeetingConfig, meetingDate: string): string {
  const weekOffset = Math.floor(daysBetween(config.cycle.anchor_date, meetingDate) / 7);
  return config.cycle.rotation[modulo(weekOffset, config.cycle.rotation.length)];
}

/** The theme's current or next meeting date: the first Wednesday from the default plan date whose cycle group is the theme's. */
export function nextThemeMeetingDate(config: ThemeMeetingConfig, themeId: string, now = new Date()): string | null {
  const group = config.themes.find((theme) => theme.theme_id === themeId)?.cycle_group;
  const start = upcomingWednesday(now, config.timezone);
  for (let week = 0; group && week < config.cycle.rotation.length; week += 1) {
    const date = addDays(start, week * 7);
    if (cycleGroupForDate(config, date) === group) return date;
  }
  return null;
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeUsername(value: string | null | undefined): string {
  return value ? value.trim().toLowerCase() : '';
}

async function userDirectory(): Promise<
  Map<string, Pick<AuthUser, 'username' | 'displayName' | 'aliases' | 'provisioningStatus'>>
> {
  try {
    const users = await listUsersForAdmin();
    return new Map(users.map((user) => [normalizeUsername(user.username), user]));
  } catch {
    return new Map();
  }
}

function memberEntries(
  theme: ThemeMeetingConfig['themes'][number],
  usersByUsername: Map<string, Pick<AuthUser, 'username' | 'displayName' | 'aliases' | 'provisioningStatus'>>,
): Array<{ username?: string; displayName: string }> {
  if (theme.member_users?.length) {
    return theme.member_users
      .map((username, index) => {
        const normalized = normalizeUsername(username);
        const user = usersByUsername.get(normalized);
        if (user && user.provisioningStatus !== 'active') return null;
        return {
          username: normalized,
          displayName: user?.displayName || theme.members[index] || username,
        };
      })
      .filter((entry): entry is { username: string; displayName: string } => Boolean(entry));
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

function configuredThemeUsernames(config: ThemeMeetingConfig): string[] {
  return [
    ...config.pi_users,
    config.administrator_user || '',
    ...config.themes.flatMap((theme) => [theme.coordinator_user || '', ...(theme.member_users || [])]),
  ]
    .map(normalizeUsername)
    .filter(Boolean)
    .filter((username, index, usernames) => usernames.indexOf(username) === index);
}

function assertConfiguredUsersActive(
  config: ThemeMeetingConfig,
  usersByUsername: Map<string, Pick<AuthUser, 'username' | 'displayName' | 'aliases' | 'provisioningStatus'>>,
) {
  const missing: string[] = [];
  const inactive: string[] = [];

  for (const username of configuredThemeUsernames(config)) {
    const user = usersByUsername.get(username);
    if (!user) {
      missing.push(username);
    } else if (user.provisioningStatus !== 'active') {
      inactive.push(username);
    }
  }

  if (missing.length || inactive.length) {
    const parts = [
      missing.length ? `missing users: ${missing.join(', ')}` : '',
      inactive.length ? `inactive users: ${inactive.join(', ')}` : '',
    ].filter(Boolean);
    throw new Error(`Theme meeting config references ${parts.join('; ')}.`);
  }
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
  usersByUsername: Map<string, Pick<AuthUser, 'username' | 'displayName' | 'aliases' | 'provisioningStatus'>>,
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
  if (user && user.provisioningStatus !== 'active') {
    throw new Error('Theme meeting updates require an active account.');
  }
  throw new Error(`Member ${member.trim()} is not configured for Theme ${themeId}.`);
}

function updateDuration(config: ThemeMeetingConfig, updateType: ThemeUpdateType): number {
  return config.submission.update_types[updateType]?.duration_minutes ?? 0;
}

function reminderSetting(config: ThemeMeetingConfig, name: string, key: 'weekday' | 'time', fallback: string): string {
  const reminder = config.reminders.find((nextReminder) => nextReminder.name === name);
  const value = reminder?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function configuredReminderTime(config: ThemeMeetingConfig, name: string, fallback: string): string {
  const value = reminderSetting(config, name, 'time', fallback);
  return value && timePattern.test(value) ? value : fallback;
}

function normalizedWeekday(value: string, fallback: string): string {
  return weekdays.find((weekday) => weekday.toLowerCase() === value.trim().toLowerCase()) || fallback;
}

function configuredReminderWeekday(config: ThemeMeetingConfig, name: string, fallback: string): string {
  return normalizedWeekday(reminderSetting(config, name, 'weekday', fallback), fallback);
}

export function configuredReminderSchedule(config: ThemeMeetingConfig) {
  return {
    firstReminder: {
      weekday: configuredReminderWeekday(config, 'first_reminder', 'Monday'),
      time: configuredReminderTime(config, 'first_reminder', '10:00'),
    },
    gentleReminder: {
      weekday: configuredReminderWeekday(config, 'gentle_missing_update_reminder', 'Tuesday'),
      time: configuredReminderTime(config, 'gentle_missing_update_reminder', '10:00'),
    },
    agendaPreview: {
      weekday: configuredReminderWeekday(config, 'agenda_preview', 'Tuesday'),
      time: configuredReminderTime(config, 'agenda_preview', '13:00'),
    },
    agendaCutoff: {
      weekday: configuredReminderWeekday(config, 'agenda_cutoff', 'Wednesday'),
      time: configuredReminderTime(config, 'agenda_cutoff', '08:00'),
    },
  };
}

export function submissionDeadline(config: ThemeMeetingConfig, meetingDate: string): string {
  const cutoff = configuredReminderSchedule(config).agendaCutoff;
  const meetingWeekday = parseDateOnly(meetingDate).getUTCDay();
  const cutoffWeekday = (weekdays.indexOf(cutoff.weekday as (typeof weekdays)[number]) + 1) % 7;
  return `${addDays(meetingDate, -modulo(meetingWeekday - cutoffWeekday, 7))}T${cutoff.time}`;
}

export async function buildThemeMeetingPlan(options: BuildThemeMeetingPlanOptions = {}): Promise<{
  configPath: string;
  cancellationsPath: string;
  updatesPath: string;
  notificationsPath: string;
  config: ThemeMeetingConfig;
  plan: ThemeMeetingPlan;
  notifications: ThemeMeetingNotification[];
  cancellations: ThemeMeetingCancellation[];
}> {
  const { path: configPath, config } = await readThemeMeetingConfig(options);
  const { path: cancellationsPath, cancellations } = await readThemeMeetingCancellations(options);
  const { path: updatesPath, updates } = await readThemeMeetingUpdates(options);
  const { path: notificationsPath, notifications } = await readThemeMeetingNotifications(options);
  const usersByUsername = await userDirectory();
  if (options.validateUsers) {
    assertConfiguredUsersActive(config, usersByUsername);
  }
  const meetingDate = options.meetingDate || upcomingWednesday(options.now, config.timezone);
  const cycleGroup = cycleGroupForDate(config, meetingDate);
  const activeThemes = config.themes.filter((theme) => theme.cycle_group === cycleGroup);
  const generatedAt = (options.now || new Date()).toISOString();
  const relevantUpdates = updates.filter((update) => update.meeting_date === meetingDate);
  const cancellationsByMeeting = new Map(
    cancellations
      .filter((cancellation) => cancellation.meeting_date === meetingDate)
      .map((cancellation) => [meetingKey(cancellation.meeting_date, cancellation.theme_id), cancellation]),
  );

  const plan = themeMeetingPlanSchema.parse({
    meeting_date: meetingDate,
    timezone: config.timezone,
    cycle_group: cycleGroup,
    generated_at: generatedAt,
    meetings: activeThemes.map((theme) => {
      const cancellation = cancellationsByMeeting.get(meetingKey(meetingDate, theme.theme_id)) || null;
      const cancelled = Boolean(cancellation);
      const entries = memberEntries(theme, usersByUsername);
      const updateByMember = new Map(
        relevantUpdates
          .filter((update) => update.theme_id === theme.theme_id)
          .flatMap((update) => updateLookupKeys(update).map((key) => [key, update] as const)),
      );
      const submittedEntries = cancelled ? [] : entries.filter((entry) => getUpdateForEntry(updateByMember, entry));
      const missingEntries = cancelled ? [] : entries.filter((entry) => !getUpdateForEntry(updateByMember, entry));
      const submittedItems = (cancelled ? [] : entries)
        .map((entry) => getUpdateForEntry(updateByMember, entry))
        .filter((update): update is ThemeMeetingUpdate => Boolean(update))
        .map((update) => ({
          meeting_date: update.meeting_date,
          theme_id: theme.theme_id,
          theme_title: theme.title,
          member: update.member,
          member_username: update.member_username,
          update_type: update.update_type,
          duration_minutes: updateDuration(config, update.update_type),
          progress_text: update.progress_text,
          ...(update.project_context ? { project_context: update.project_context } : {}),
          questions: update.questions,
          submitted_at: update.submitted_at,
        }));
      const agendaItems = cancelled ? [] : defaultAgenda(submittedItems, meetingDate, theme.theme_id, theme.title);
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
        agenda_items: agendaItems,
        planned_minutes: plannedMinutes,
        overbooked: plannedMinutes > theme.duration_minutes,
        cancelled,
        cancellation,
      };
    }),
  });

  const effectivePlan = options.rawAgenda ? plan : applyConfirmedAgendas(plan, await readMeetingWorkflow(options));
  return { configPath, cancellationsPath, updatesPath, notificationsPath, config, plan: effectivePlan, notifications, cancellations };
}

export async function cancelThemeMeeting(input: CancelThemeMeetingInput): Promise<ThemeMeetingCancellation> {
  const { config } = await readThemeMeetingConfig(input);
  const cycleGroup = cycleGroupForDate(config, input.meetingDate);
  if (!config.themes.some((theme) => theme.theme_id === input.themeId && theme.cycle_group === cycleGroup)) {
    throw new Error(`Theme ${input.themeId} is not active on ${input.meetingDate}.`);
  }

  const cancellation = {
    meeting_date: input.meetingDate,
    theme_id: input.themeId,
    cancelled_at: (input.now || new Date()).toISOString(),
    cancelled_by_username: normalizeUsername(input.cancelledByUsername),
    reason: input.reason?.trim() || '',
  };
  await saveThemeMeetingCancellation(cancellation, input);
  return cancellation;
}

export async function submitThemeMeetingUpdate(input: SubmitThemeMeetingUpdateInput): Promise<{
  update: ThemeMeetingUpdate;
  plan: ThemeMeetingPlan;
}> {
  const { config } = await readThemeMeetingConfig(input);
  const usersByUsername = await userDirectory();
  if (input.validateUsers) {
    assertConfiguredUsersActive(config, usersByUsername);
  }
  const meetingDate = meetingDateSchema.parse(input.meetingDate || upcomingWednesday(input.now, config.timezone));
  const scheduledTheme = config.themes.find((theme) => theme.theme_id === input.themeId);
  if (!scheduledTheme) throw new Error(`Unknown theme: ${input.themeId}`);
  if (parseDateOnly(meetingDate).getUTCDay() !== targetWeekday || cycleGroupForDate(config, meetingDate) !== scheduledTheme.cycle_group) {
    throw new Error(`${scheduledTheme.title} does not meet on ${formatDay(meetingDate)}. Choose one of its scheduled meeting dates.`);
  }
  const deadline = submissionDeadline(config, meetingDate);
  if (localDateTimeString(input.now || new Date(), config.timezone) >= deadline) {
    throw new Error(`Theme ${input.themeId} updates are locked after ${formatDay(deadline.slice(0, 10))}, ${deadline.slice(11)} (UK time).`);
  }
  const { cancellations } = await readThemeMeetingCancellations(input);
  if (cancellations.some((cancellation) => meetingKey(cancellation.meeting_date, cancellation.theme_id) === meetingKey(meetingDate, input.themeId))) {
    throw new Error(`Theme ${input.themeId} meeting on ${formatDay(meetingDate)} has been skipped.`);
  }
  const member = canonicalMember(config, input.themeId, input.member, usersByUsername);
  const questions = input.questions?.trim() || '';
  const updateTypeConfig = config.submission.update_types[input.updateType];
  const progressText = input.progressText?.trim() || (input.updateType === 'nothing_to_report' ? 'Nothing to report.' : '');

  if (updateTypeConfig?.questions_required && !questions) {
    throw new Error('Questions are required for this theme meeting slot.');
  }
  if (!progressText) {
    throw new Error('Progress text is required for this theme meeting slot.');
  }
  if (progressText.split(/\s+/).length > 75) {
    throw new Error('Theme meeting progress must be 75 words or fewer. Aim for 50 words.');
  }

  const update = themeMeetingUpdateSchema.parse({
    meeting_date: meetingDate,
    theme_id: input.themeId,
    member: member.displayName,
    member_username: member.username,
    update_type: input.updateType,
    progress_text: progressText,
    project_context: input.projectContext,
    questions,
    submitted_at: (input.now || new Date()).toISOString(),
    submitted_via: input.submittedVia || 'api',
  });

  await saveThemeMeetingUpdate(update, input);
  const { plan } = await buildThemeMeetingPlan({ ...input, meetingDate });
  return { update, plan };
}

function notificationBody(
  action: ThemeReminderAction,
  member: string,
  themeId: string,
  cutoff: { weekday: string; time: string },
): string {
  // Addressed to the member; theme managers see a third-person version (see visibleNotificationsForUser).
  if (action === 'agenda_cutoff') {
    return `You have no project progress update for Theme ${themeId}. Your item will not be planned into the agenda.`;
  }

  if (action === 'gentle_missing_update_reminder' || action === 'manual_missing_update_reminder') {
    return `${member}, please add your Theme ${themeId} project progress update before ${cutoff.weekday} ${cutoff.time}.`;
  }

  return `${member}, please add your Theme ${themeId} project progress update for this week's meeting.`;
}

export async function buildThemeMeetingReminderRun(
  action: ThemeReminderAction,
  options: BuildThemeMeetingReminderRunOptions = {},
): Promise<ThemeMeetingReminderRun> {
  const { config, plan } = await buildThemeMeetingPlan({ ...options, rawAgenda: action === 'agenda_preview' });
  const reminderSchedule = configuredReminderSchedule(config);
  const createdAt = (options.now || new Date()).toISOString();
  const meetings = (options.themeId
    ? plan.meetings.filter((meeting) => meeting.theme_id === options.themeId)
    : plan.meetings
  ).filter((meeting) => !meeting.cancelled);

  if (options.themeId && !meetings.length) {
    throw new Error(`Theme ${options.themeId} is not active on ${formatDay(plan.meeting_date)}.`);
  }

  const notifications = action === 'agenda_preview' ? [] : meetings.flatMap((meeting) => {
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
        body: notificationBody(action, member, meeting.theme_id, reminderSchedule.agendaCutoff),
        created_at: createdAt,
        read: false,
      }),
    );
  });

  if (!options.previewOnly && action !== 'agenda_preview') await saveThemeMeetingNotifications(notifications, options);
  return {
    action,
    config,
    plan,
    notifications,
    markdown: renderReminderRun(action, plan, notifications),
  };
}

export async function sendThemeMeetingReminderEmails(
  notifications: ThemeMeetingNotification[],
  options: ThemeMeetingStoreOptions = {},
): Promise<ThemeMeetingReminderEmailResult> {
  const users = new Map<string, AuthUser | null>();
  const result: ThemeMeetingReminderEmailResult = { sent: 0, skipped: 0, failed: 0 };

  for (const notification of notifications) {
    const username = normalizeUsername(notification.member_username);
    if (!username) {
      result.skipped += 1;
      continue;
    }

    if (!users.has(username)) {
      users.set(username, await getUserByUsername(username));
    }
    const user = users.get(username);
    const topic = notification.action === 'agenda_cutoff' ? 'theme_meeting_reminders' : 'project_progress_reminders';
    const email = registeredNotificationEmail(user?.email);
    if (!user || user.provisioningStatus !== 'active' || !email || !user.notificationPreferences[topic].email) {
      result.skipped += 1;
      continue;
    }
    const deliveryId = `theme-reminder:${notification.id}:${username}`;

    try {
      const sent = await sendClaimedThemeMeetingEmail(
        deliveryId,
        {
          to: email,
          subject: notification.title,
          text: `${notification.body}\n\nMeeting date: ${formatLongDay(notification.meeting_date)}\nTheme: ${notification.theme_id}\n\nOpen VioScope to respond.`,
        },
        options,
      );
      result.sent += sent ? 1 : 0;
      result.skipped += sent ? 0 : 1;
    } catch (error) {
      result.failed += 1;
      console.warn('Could not send theme meeting reminder email:', error);
    }
  }

  return result;
}

type AgendaEmailRecipient = { username: string; displayName: string; email: string | null; plan: ThemeMeetingPlan; deliveryId: string };

// Single source of the agenda email audience: who is addressed, who can receive it (active, registered address,
// theme meeting email preference on) and the delivery id used for deduplication.
async function agendaEmailRecipients(
  plan: ThemeMeetingPlan,
  config: ThemeMeetingConfig,
  options: Pick<ThemeMeetingAgendaEmailOptions, 'themeId' | 'phase'> & { version?: number },
): Promise<AgendaEmailRecipient[]> {
  if (options.version !== undefined && !options.themeId) throw new Error('A confirmed agenda is sent for one theme.');
  const preview = options.phase === 'preview';
  const recipients = preview
    ? themeAgendaPreviewRecipients(plan, options.themeId)
    : themeAgendaRecipients(plan, await listThemeAgendaSubscriptions(), options.themeId);
  const audience: AgendaEmailRecipient[] = [];
  for (const [username, recipientPlan] of recipients) {
    const user = await getUserByUsername(username);
    const email = registeredNotificationEmail(user?.email);
    const eligible = Boolean(user && user.provisioningStatus === 'active' && email && user.notificationPreferences.theme_meeting_reminders.email);
    audience.push({
      username, displayName: user?.displayName || username, plan: recipientPlan, email: eligible ? email : null,
      deliveryId: options.version !== undefined
        ? `${confirmedAgendaDeliveryPrefix(plan.meeting_date, options.themeId!, options.version)}${username}`
        : `${preview ? 'theme-agenda-preview' : 'theme-agenda'}:${plan.meeting_date}:${options.themeId || 'all'}:${username}`,
    });
  }
  return audience;
}

export type ConfirmedAgendaEmailAudience = {
  version: number;
  /** False when the server cannot send email; every recipient would then be skipped. */
  emailEnabled: boolean;
  /** Recipients who can receive email; never includes addresses. */
  recipients: Array<{ username: string; displayName: string; alreadySent: boolean }>;
  /** Addressed accounts that will be skipped: inactive, no registered email, or theme meeting emails switched off. */
  skipped: number;
};

/** Preview of what emailing a confirmed version would do, using the same audience and dedupe as the send. */
export async function confirmedAgendaEmailAudience(
  plan: ThemeMeetingPlan,
  config: ThemeMeetingConfig,
  themeId: string,
  version: number,
  options: ThemeMeetingStoreOptions = {},
): Promise<ConfirmedAgendaEmailAudience> {
  const audience = await agendaEmailRecipients(plan, config, { themeId, version });
  const delivered = new Set((await readThemeMeetingEmailDeliveries(options)).deliveries.map((delivery) => delivery.id));
  const reachable = audience.filter((recipient) => recipient.email);
  // Mirrors claimThemeMeetingEmailDelivery: a recorded delivery or an existing claim means the send skips this recipient.
  const recipients = await Promise.all(reachable.map(async ({ username, displayName, deliveryId }) => ({
    username, displayName, alreadySent: delivered.has(deliveryId) || await hasThemeMeetingEmailDeliveryClaim(deliveryId, options) })));
  return { version, emailEnabled: notificationEmailEnabled(), skipped: audience.length - reachable.length, recipients };
}

async function confirmedAgendasByTheme(plan: ThemeMeetingPlan, options: ThemeMeetingStoreOptions): Promise<Record<string, ConfirmedAgendaEmail>> {
  const state = await readMeetingWorkflow(options);
  const result: Record<string, ConfirmedAgendaEmail> = {};
  for (const meeting of plan.meetings) {
    const saved = latestConfirmation(state, plan.meeting_date, meeting.theme_id);
    if (saved && !meeting.cancelled) {
      result[meeting.theme_id] = { version: saved.version, confirmedBy: saved.confirmedBy, confirmedAt: saved.confirmedAt,
        skipped: saved.entries.filter((entry) => entry.deferred).map(({ deferred: _, ...entry }) => entry) };
    }
  }
  return result;
}

export async function sendThemeMeetingAgendaEmails(
  plan: ThemeMeetingPlan,
  config: ThemeMeetingConfig,
  options: ThemeMeetingAgendaEmailOptions = {},
): Promise<ThemeMeetingReminderEmailResult> {
  const result: ThemeMeetingReminderEmailResult = { sent: 0, skipped: 0, failed: 0 };
  const preview = options.phase === 'preview';
  const confirmation = options.confirmation;
  const recipients = await agendaEmailRecipients(plan, config, { themeId: options.themeId, phase: options.phase, version: confirmation?.version });
  // The cutoff circulation must not contradict a human confirmation: confirmed themes use their confirmed version.
  const confirmations = preview || confirmation ? undefined : await confirmedAgendasByTheme(plan, options);
  const subjectFor = (recipientPlan: ThemeMeetingPlan) => {
    const live = recipientPlan.meetings.filter((meeting) => !meeting.cancelled);
    const allConfirmed = Boolean(confirmation) || (live.length > 0 && live.every((meeting) => confirmations?.[meeting.theme_id]));
    return `${preview ? '[DRAFT] VioScope theme meeting agenda preview' : allConfirmed ? 'VioScope confirmed theme meeting agenda' : 'VioScope advisory theme meeting agenda'} ${formatDay(plan.meeting_date)}${
      options.themeId ? ` Theme ${options.themeId}` : ''
    }${confirmation ? ` (version ${confirmation.version})` : ''}`;
  };

  for (const { email, plan: recipientPlan, deliveryId } of recipients) {
    if (!email) {
      result.skipped += 1;
      continue;
    }

    try {
      const sent = await sendClaimedThemeMeetingEmail(
        deliveryId,
        {
          to: email,
          subject: subjectFor(recipientPlan),
          ...renderThemeMeetingAgendaEmail(recipientPlan, { phase: options.phase, cutoff: configuredReminderSchedule(config).agendaCutoff, confirmation, confirmations }),
        },
        options,
      );
      result.sent += sent ? 1 : 0;
      result.skipped += sent ? 0 : 1;
    } catch (error) {
      result.failed += 1;
      console.warn('Could not send theme meeting agenda email:', error);
    }
  }

  return result;
}

export async function updateThemeMeetingMember(input: UpdateThemeMeetingMemberInput): Promise<{
  user: AuthUser;
  plan: ThemeMeetingPlan;
  config: ThemeMeetingConfig;
}> {
  // Read-modify-write of the whole config file under the same advisory lock as the config route.
  const { path: configPath } = await readThemeMeetingConfig(input);
  const result = await withFileLock(configPath, async () => {
  const { config } = await readThemeMeetingConfig({ ...input, configPath });
  const user = input.userId
    ? await getUserById(input.userId)
    : input.username
      ? await getUserByUsername(input.username)
      : null;

  if (!user) {
    throw new Error('User not found.');
  }
  if (user.provisioningStatus !== 'active') {
    throw new Error('Only active accounts can be theme meeting members.');
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
  return { config, user };
  });
  const { plan } = await buildThemeMeetingPlan({ ...input, meetingDate: input.meetingDate });
  return { user: result.user, plan, config: result.config };
}

export function renderThemeMeetingPlan(plan: ThemeMeetingPlan): string {
  const meetings = plan.meetings
    .filter((meeting) => !meeting.cancelled)
    .map((meeting) => {
      const agenda = meeting.agenda_items.length
        ? meeting.agenda_items
            .map(
              (item) =>
                `  - ${item.member}: ${themeAgendaTypeLabels[item.update_type]} (${item.duration_minutes} min) - ${item.progress_text}${
                  item.questions ? ` Questions: ${item.questions}` : ''
                }${item.project_context ? `\n${formatMeetingProject(item.project_context)}` : ''}`,
            )
            .join('\n')
        : '  - No planned updates yet';

      return `## Theme ${meeting.theme_id} - ${meeting.title} (${meeting.time}, ${meeting.duration_minutes} min)
- Coordinator: ${meeting.coordinator}
- Submitted: ${meeting.submitted_members.length}/${meeting.members.length}
- Planned minutes: ${meeting.planned_minutes}/${meeting.duration_minutes}${meeting.overbooked ? ' (overbooked)' : ''}
- Missing: ${meeting.missing_members.join(', ') || 'none'}
Agenda:
${agenda}`;
    })
    .join('\n\n');

  return `# Theme Meeting Plan

- Date: ${plan.meeting_date}
- Cycle group: ${plan.cycle_group}
- Timezone: ${plan.timezone}

${meetings || 'No active theme meetings are scheduled.'}
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
