import 'dotenv/config';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  buildThemeMeetingPlan,
  buildThemeMeetingReminderRun,
  submitThemeMeetingUpdate,
} from '../src/mastra/theme-meetings/planner';
import { readThemeMeetingPlanTool, submitThemeMeetingUpdateTool } from '../src/mastra/tools/theme-meetings';
import { managedThemeIdsForUser, visiblePlanForUser } from '../src/mastra/theme-meetings/access';
import { defaultNotificationPreferences, type AuthUser } from '../src/mastra/db/users';
import { registeredNotificationEmail } from '../src/mastra/email';
import {
  claimThemeMeetingEmailDelivery,
  hasThemeMeetingEmailDelivery,
  readThemeMeetingEmailDeliveries,
  readThemeMeetingNotifications,
  readThemeMeetingUpdates,
  releaseThemeMeetingEmailDeliveryClaim,
  saveThemeMeetingEmailDelivery,
} from '../src/mastra/theme-meetings/store';
import { createPostgresClient } from '../src/mastra/db/postgres';
import { upsertLocalUser } from '../src/mastra/db/users';

const stamp = Date.now().toString(36);
const checkDir = join(tmpdir(), 'vioscope-agent-smoke', `theme-meeting-check-${stamp}`);
const themeUsers = {
  coordA: `theme.meeting.check.coord.a.${stamp}`,
  coordB: `theme.meeting.check.coord.b.${stamp}`,
  coordC: `theme.meeting.check.coord.c.${stamp}`,
  coordD: `theme.meeting.check.coord.d.${stamp}`,
  alice: `theme.meeting.check.alice.${stamp}`,
  bob: `theme.meeting.check.bob.${stamp}`,
  carla: `theme.meeting.check.carla.${stamp}`,
  dan: `theme.meeting.check.dan.${stamp}`,
  erin: `theme.meeting.check.erin.${stamp}`,
  farah: `theme.meeting.check.farah.${stamp}`,
  gabe: `theme.meeting.check.gabe.${stamp}`,
  hana: `theme.meeting.check.hana.${stamp}`,
};
const storePaths = {
  configPath: join(checkDir, 'theme-meeting-config.yaml'),
  emailDeliveriesPath: join(checkDir, 'theme-meeting-email-deliveries.yaml'),
  updatesPath: join(checkDir, 'theme-meeting-updates.yaml'),
  notificationsPath: join(checkDir, 'theme-meeting-notifications.yaml'),
};
const checkMeetingDate = '2026-06-24';
const latestAliceProgress = 'Changed plan: use the slot to decide which result table should anchor the next experiment.';

function fakeUser(displayName: string, role: AuthUser['role'] = 'member'): AuthUser {
  return {
    id: `check-${displayName.toLowerCase().replace(/\s+/g, '-')}`,
    username: displayName.toLowerCase().replace(/\s+/g, '.'),
    displayName,
    email: `${displayName.toLowerCase().replace(/\s+/g, '.')}@example.test`,
    role,
    position: null,
    provisioningStatus: 'active',
    sourceProfileId: null,
    aliases: [],
    notificationPreferences: defaultNotificationPreferences(),
    passwordResetRequired: false,
    passwordChangedAt: null,
    lastLoginAt: null,
  };
}

async function cleanupSmokeFiles() {
  await rm(checkDir, { recursive: true, force: true });
}

async function cleanupSmokeUsers() {
  const postgres = createPostgresClient('theme-meeting-check-cleanup');
  try {
    await postgres.pool.query('DELETE FROM users WHERE source = $1 AND username = ANY($2::text[])', [
      'theme_meeting_check',
      Object.values(themeUsers),
    ]).catch(() => undefined);
  } finally {
    await postgres.disconnect();
  }
}

async function seedSmokeUser(username: string, displayName: string, role: AuthUser['role']) {
  await upsertLocalUser({
    username,
    displayName,
    email: `${username}@example.test`,
    password: 'ThemeMeetingCheck1!',
    role,
    passwordResetRequired: false,
    source: 'theme_meeting_check',
    metadata: { temporary_theme_meeting_check: true },
  });
}

async function seedSmokeUsers() {
  await Promise.all([
    seedSmokeUser(themeUsers.coordA, 'Coordinator A', 'organizer'),
    seedSmokeUser(themeUsers.coordB, 'Coordinator B', 'organizer'),
    seedSmokeUser(themeUsers.coordC, 'Coordinator C', 'organizer'),
    seedSmokeUser(themeUsers.coordD, 'Coordinator D', 'organizer'),
    seedSmokeUser(themeUsers.alice, 'Alice', 'member'),
    seedSmokeUser(themeUsers.bob, 'Bob', 'member'),
    seedSmokeUser(themeUsers.carla, 'Carla', 'member'),
    seedSmokeUser(themeUsers.dan, 'Dan', 'member'),
    seedSmokeUser(themeUsers.erin, 'Erin', 'member'),
    seedSmokeUser(themeUsers.farah, 'Farah', 'member'),
    seedSmokeUser(themeUsers.gabe, 'Gabe', 'member'),
    seedSmokeUser(themeUsers.hana, 'Hana', 'member'),
  ]);
}

async function writeSmokeConfig() {
  await mkdir(dirname(storePaths.configPath), { recursive: true });
  await writeFile(
    storePaths.configPath,
    `timezone: Europe/London
cycle:
  weekday: Wednesday
  rotation:
    - AB
    - CD
  anchor_date: 2026-06-24
pis:
  - PI One
  - PI Two
administrator: Admin User
themes:
  - theme_id: A
    title: Example Theme A
    cycle_group: AB
    weekday: Wednesday
    time: "10:00"
    duration_minutes: 60
    coordinator: Coordinator A
    coordinator_user: ${themeUsers.coordA}
    members:
      - Alice
      - Bob
    member_users:
      - ${themeUsers.alice}
      - ${themeUsers.bob}
  - theme_id: B
    title: Example Theme B
    cycle_group: AB
    weekday: Wednesday
    time: "11:00"
    duration_minutes: 60
    coordinator: Coordinator B
    coordinator_user: ${themeUsers.coordB}
    members:
      - Carla
      - Dan
    member_users:
      - ${themeUsers.carla}
      - ${themeUsers.dan}
  - theme_id: C
    title: Example Theme C
    cycle_group: CD
    weekday: Wednesday
    time: "10:00"
    duration_minutes: 60
    coordinator: Coordinator C
    coordinator_user: ${themeUsers.coordC}
    members:
      - Erin
      - Farah
    member_users:
      - ${themeUsers.erin}
      - ${themeUsers.farah}
  - theme_id: D
    title: Example Theme D
    cycle_group: CD
    weekday: Wednesday
    time: "11:00"
    duration_minutes: 60
    coordinator: Coordinator D
    coordinator_user: ${themeUsers.coordD}
    members:
      - Gabe
      - Hana
    member_users:
      - ${themeUsers.gabe}
      - ${themeUsers.hana}
submission:
  progress_word_target: 50
  update_types:
    nothing_to_report:
      duration_minutes: 0
      questions_required: false
    deep_dive:
      duration_minutes: 30
      questions_required: false
    milestone_check:
      duration_minutes: 10
      questions_required: false
    strategic_slot:
      duration_minutes: 10
      questions_required: false
reminders:
  - name: first_reminder
    weekday: Monday
    time: "08:00"
    channel: browser
  - name: gentle_missing_update_reminder
    weekday: Tuesday
    time: "04:00"
    channel: browser
    only_if_missing_update: true
  - name: agenda_cutoff
    weekday: Wednesday
    time: "08:00"
    action: mark_missing_project_progress_and_build_agenda
permissions: {}
`,
    'utf8',
  );
}

async function withThemeMeetingEnv<T>(run: () => Promise<T>): Promise<T> {
  const previous = {
    THEME_MEETING_CONFIG_PATH: process.env.THEME_MEETING_CONFIG_PATH,
    THEME_MEETING_UPDATES_PATH: process.env.THEME_MEETING_UPDATES_PATH,
    THEME_MEETING_NOTIFICATIONS_PATH: process.env.THEME_MEETING_NOTIFICATIONS_PATH,
    THEME_MEETING_EMAIL_DELIVERIES_PATH: process.env.THEME_MEETING_EMAIL_DELIVERIES_PATH,
  };

  process.env.THEME_MEETING_CONFIG_PATH = storePaths.configPath;
  process.env.THEME_MEETING_UPDATES_PATH = storePaths.updatesPath;
  process.env.THEME_MEETING_NOTIFICATIONS_PATH = storePaths.notificationsPath;
  process.env.THEME_MEETING_EMAIL_DELIVERIES_PATH = storePaths.emailDeliveriesPath;

  try {
    return await run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') {
    throw new Error('Expected theme meeting tool to return an object.');
  }
  return value as Record<string, unknown>;
}

function toolContext(user: AuthUser) {
  return {
    requestContext: {
      get: (key: string) => (key === 'vioscope-user' ? user : undefined),
    },
  };
}

async function runAgentThemeMeetingCheck(): Promise<{ submittedVia: unknown; updateMarkdown: string; planMarkdown: string }> {
  return withThemeMeetingEnv(async () => {
    if (!submitThemeMeetingUpdateTool.execute || !readThemeMeetingPlanTool.execute) {
      throw new Error('Agent theme meeting tools are missing execute().');
    }
    const alice = fakeUser('Alice');

    const updateResult = asRecord(
      await submitThemeMeetingUpdateTool.execute(
        {
          meetingDate: checkMeetingDate,
          themeId: 'A',
          member: 'alice',
          updateType: 'strategic_slot',
          progressText: latestAliceProgress,
        },
        toolContext(alice) as never,
      ),
    );
    const planResult = asRecord(
      await readThemeMeetingPlanTool.execute({ meetingDate: checkMeetingDate }, toolContext(alice) as never),
    );
    const update = asRecord(updateResult.update);

    return {
      submittedVia: update.submitted_via,
      updateMarkdown: String(updateResult.markdown || ''),
      planMarkdown: String(planResult.markdown || ''),
    };
  });
}

async function main() {
  await cleanupSmokeUsers();
  await cleanupSmokeFiles();
  await seedSmokeUsers();
  await writeSmokeConfig();
  const ab = await buildThemeMeetingPlan({ ...storePaths, meetingDate: checkMeetingDate });
  const cd = await buildThemeMeetingPlan({ ...storePaths, meetingDate: '2026-07-01' });

  if (ab.plan.cycle_group !== 'AB') {
    throw new Error(`Expected ${checkMeetingDate} to be AB, got ${ab.plan.cycle_group}.`);
  }

  if (cd.plan.cycle_group !== 'CD') {
    throw new Error(`Expected 2026-07-01 to be CD, got ${cd.plan.cycle_group}.`);
  }

  await mkdir(dirname(storePaths.updatesPath), { recursive: true });
  await writeFile(
    storePaths.updatesPath,
    `updates:
  - meeting_date: ${checkMeetingDate}
    theme_id: A
    member: Alice
    update_type: short_update
    progress_text: Legacy short update.
    questions: ''
    submitted_at: 2026-06-22T08:00:00.000Z
    submitted_via: api
`,
    'utf8',
  );
  const legacyUpdate = await buildThemeMeetingPlan({ ...storePaths, meetingDate: checkMeetingDate });
  const legacyThemeA = legacyUpdate.plan.meetings.find((meeting) => meeting.theme_id === 'A');
  if (!legacyThemeA?.agenda_items.some((item) => item.member === 'Alice' && item.update_type === 'milestone_check')) {
    throw new Error('Expected legacy short_update to load as milestone_check.');
  }

  await submitThemeMeetingUpdate({
    ...storePaths,
    meetingDate: checkMeetingDate,
    themeId: 'A',
    member: 'Alice',
    updateType: 'milestone_check',
    progressText: 'Finished the first experiment pass and will show the current result table.',
    submittedVia: 'api',
    now: new Date('2026-06-22T08:00:00.000Z'),
  });
  const agentCheck = await runAgentThemeMeetingCheck();
  if (
    agentCheck.submittedVia !== 'chat' ||
    !agentCheck.updateMarkdown.includes(latestAliceProgress) ||
    !agentCheck.planMarkdown.includes(latestAliceProgress)
  ) {
    throw new Error('Expected agent tools to save and plan from Alice latest update.');
  }

  const storedAliceUpdates = (await readThemeMeetingUpdates(storePaths)).updates.filter(
    (update) => update.meeting_date === checkMeetingDate && update.theme_id === 'A' && update.member_username === themeUsers.alice,
  );
  if (storedAliceUpdates.length !== 1) {
    throw new Error(`Expected Alice's second Theme A update to replace the first, found ${storedAliceUpdates.length}.`);
  }
  if (
    storedAliceUpdates[0]?.update_type !== 'strategic_slot' ||
    storedAliceUpdates[0]?.progress_text !== latestAliceProgress
  ) {
    throw new Error('Expected Alice stored update to contain the latest mock agent updater payload.');
  }

  const afterUpdate = await buildThemeMeetingPlan({ ...storePaths, meetingDate: checkMeetingDate });
  const themeA = afterUpdate.plan.meetings.find((meeting) => meeting.theme_id === 'A');
  if (!themeA) {
    throw new Error(`Expected Theme A to be active on ${checkMeetingDate}.`);
  }

  const aliceAgendaItems = themeA.agenda_items.filter((item) => item.member_username === themeUsers.alice);
  if (
    aliceAgendaItems.length !== 1 ||
    aliceAgendaItems[0]?.update_type !== 'strategic_slot' ||
    aliceAgendaItems[0]?.duration_minutes !== 10
  ) {
    throw new Error('Expected Alice latest strategic-slot update to be the only Theme A agenda item for Alice.');
  }

  const alicePlan = visiblePlanForUser(afterUpdate.plan, afterUpdate.config, fakeUser('Alice'));
  const coordinatorPlan = visiblePlanForUser(afterUpdate.plan, afterUpdate.config, fakeUser('Coordinator A'));
  const piPlan = visiblePlanForUser(afterUpdate.plan, afterUpdate.config, fakeUser('PI One', 'pi'));
  const coordinatorManagedThemes = managedThemeIdsForUser(afterUpdate.plan, afterUpdate.config, fakeUser('Coordinator A'));

  if (alicePlan.meetings.length !== 1 || alicePlan.meetings[0]?.members.join(',') !== 'Alice') {
    throw new Error('Expected Alice to see only her own Theme A row.');
  }

  if (coordinatorPlan.meetings.length !== 1 || coordinatorPlan.meetings[0]?.members.length !== 2) {
    throw new Error('Expected Coordinator A to see all Theme A members.');
  }

  if (piPlan.meetings.length !== afterUpdate.plan.meetings.length) {
    throw new Error('Expected PI to see all active meetings.');
  }

  if (coordinatorManagedThemes.join(',') !== 'A') {
    throw new Error(`Expected Coordinator A to manage Theme A, got ${coordinatorManagedThemes.join(',') || 'none'}.`);
  }

  const agendaCutoff = await buildThemeMeetingReminderRun('agenda_cutoff', {
    ...storePaths,
    meetingDate: checkMeetingDate,
    themeId: 'A',
    now: new Date(`${checkMeetingDate}T08:00:00.000Z`),
  });
  if (!agendaCutoff.notifications.length || !agendaCutoff.markdown.includes(latestAliceProgress)) {
    throw new Error('Expected agenda cutoff planning run to include notification payloads and latest update markdown.');
  }
  if (
    agendaCutoff.notifications.some((notification) => !notification.title || !notification.body || !notification.member)
  ) {
    throw new Error('Expected every agenda cutoff notification to include title, body, and member.');
  }
  const savedAgendaNotifications = await readThemeMeetingNotifications(storePaths);
  if (
    !agendaCutoff.notifications.every((notification) =>
      savedAgendaNotifications.notifications.some((saved) => saved.id === notification.id),
    )
  ) {
    throw new Error('Expected agenda cutoff notifications to be persisted for browser/email delivery paths.');
  }

  await submitThemeMeetingUpdate({
    ...storePaths,
    meetingDate: checkMeetingDate,
    themeId: 'A',
    member: 'Bob',
    updateType: 'nothing_to_report',
    progressText: 'Nothing to report this cycle.',
    submittedVia: 'api',
  });

  const afterNothing = await buildThemeMeetingPlan({ ...storePaths, meetingDate: checkMeetingDate });
  const themeAAfterNothing = afterNothing.plan.meetings.find((meeting) => meeting.theme_id === 'A');
  if (!themeAAfterNothing?.agenda_items.some((item) => item.member === 'Bob' && item.update_type === 'nothing_to_report' && item.duration_minutes === 0)) {
    throw new Error('Expected Bob nothing-to-report update to appear with zero planned minutes.');
  }
  if (themeAAfterNothing?.planned_minutes !== 10) {
    throw new Error(`Expected Theme A planned minutes to remain 10, got ${themeAAfterNothing?.planned_minutes}.`);
  }

  const previousCutoffTime = process.env.THEME_MEETING_CUTOFF_TIME;
  process.env.THEME_MEETING_CUTOFF_TIME = '23:59';
  const configReminder = await buildThemeMeetingReminderRun('manual_missing_update_reminder', {
    ...storePaths,
    meetingDate: checkMeetingDate,
    themeId: 'B',
    now: new Date('2026-06-23T10:00:00.000Z'),
  });
  if (previousCutoffTime === undefined) {
    delete process.env.THEME_MEETING_CUTOFF_TIME;
  } else {
    process.env.THEME_MEETING_CUTOFF_TIME = previousCutoffTime;
  }
  if (!configReminder.notifications.some((notification) => notification.body.includes('Wednesday 08:00'))) {
    throw new Error('Expected reminder cutoff text to come from theme meeting config, not legacy admin/env settings.');
  }

  const manualReminder = await buildThemeMeetingReminderRun('manual_missing_update_reminder', {
    ...storePaths,
    meetingDate: checkMeetingDate,
    themeId: 'A',
    now: new Date('2026-06-23T10:00:00.000Z'),
  });

  if (manualReminder.notifications.length !== 0) {
    throw new Error('Expected no missing Theme A members after both slots were submitted.');
  }

  const deliveryId = 'check:theme-meeting-email-delivery';
  if (await hasThemeMeetingEmailDelivery(deliveryId, storePaths)) {
    throw new Error('Expected no existing email delivery marker before save.');
  }
  await saveThemeMeetingEmailDelivery({ id: deliveryId, sent_at: '2026-06-23T10:00:00.000Z' }, storePaths);
  await saveThemeMeetingEmailDelivery({ id: deliveryId, sent_at: '2026-06-23T11:00:00.000Z' }, storePaths);
  const deliveries = (await readThemeMeetingEmailDeliveries(storePaths)).deliveries.filter(
    (delivery) => delivery.id === deliveryId,
  );
  if (deliveries.length !== 1 || !(await hasThemeMeetingEmailDelivery(deliveryId, storePaths))) {
    throw new Error('Expected email delivery markers to be idempotent by id.');
  }

  const claimId = 'check:theme-meeting-email-claim';
  const claims = await Promise.all([
    claimThemeMeetingEmailDelivery(claimId, storePaths),
    claimThemeMeetingEmailDelivery(claimId, storePaths),
  ]);
  if (claims.filter(Boolean).length !== 1) {
    throw new Error('Expected concurrent email delivery claims to allow exactly one sender.');
  }
  await releaseThemeMeetingEmailDeliveryClaim(claimId, storePaths);
  if (!(await claimThemeMeetingEmailDelivery(claimId, storePaths))) {
    throw new Error('Expected released email delivery claim to be claimable again.');
  }
  await saveThemeMeetingEmailDelivery({ id: claimId, sent_at: '2026-06-23T12:00:00.000Z' }, storePaths);
  await releaseThemeMeetingEmailDeliveryClaim(claimId, storePaths);
  if (await claimThemeMeetingEmailDelivery(claimId, storePaths)) {
    throw new Error('Expected recorded email delivery to block future claims.');
  }

  if (registeredNotificationEmail(null) !== null || registeredNotificationEmail('') !== null) {
    throw new Error('Expected missing registered email to be skipped.');
  }
  if (registeredNotificationEmail('  alice@example.test  ') !== 'alice@example.test') {
    throw new Error('Expected registered email to be normalized before sending.');
  }

  console.log('Theme meeting check passed.');
  console.log(
    JSON.stringify(
      {
        ab: ab.plan.cycle_group,
        cd: cd.plan.cycle_group,
        themeAPlannedMinutes: themeA.planned_minutes,
        themeAMissing: themeA.missing_members,
        coordinatorManagedThemes,
        manualReminderCount: manualReminder.notifications.length,
      },
      null,
      2,
    ),
  );

  await cleanupSmokeUsers();
  await cleanupSmokeFiles();
}

main()
  .finally(async () => {
    await cleanupSmokeUsers();
    await cleanupSmokeFiles();
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
