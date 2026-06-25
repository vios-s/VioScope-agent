import 'dotenv/config';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  buildThemeMeetingPlan,
  buildThemeMeetingReminderRun,
  submitThemeMeetingUpdate,
} from '../src/mastra/theme-meetings/planner';
import { managedThemeIdsForUser, visiblePlanForUser } from '../src/mastra/theme-meetings/access';
import { defaultNotificationPreferences, type AuthUser } from '../src/mastra/db/users';
import {
  claimThemeMeetingEmailDelivery,
  hasThemeMeetingEmailDelivery,
  readThemeMeetingEmailDeliveries,
  releaseThemeMeetingEmailDeliveryClaim,
  saveThemeMeetingEmailDelivery,
} from '../src/mastra/theme-meetings/store';

const storePaths = {
  configPath: 'fixtures/theme-meeting-config.example.yaml',
  emailDeliveriesPath: join(tmpdir(), 'vioscope-agent-smoke', 'theme-meeting-email-deliveries-check.yaml'),
  updatesPath: join(tmpdir(), 'vioscope-agent-smoke', 'theme-meeting-updates-check.yaml'),
  notificationsPath: join(tmpdir(), 'vioscope-agent-smoke', 'theme-meeting-notifications-check.yaml'),
};

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
  await rm(storePaths.emailDeliveriesPath, { force: true });
  await rm(`${storePaths.emailDeliveriesPath}.claims`, { recursive: true, force: true });
  await rm(storePaths.updatesPath, { force: true });
  await rm(storePaths.notificationsPath, { force: true });
}

async function main() {
  await cleanupSmokeFiles();
  const ab = await buildThemeMeetingPlan({ ...storePaths, meetingDate: '2026-06-24' });
  const cd = await buildThemeMeetingPlan({ ...storePaths, meetingDate: '2026-07-01' });

  if (ab.plan.cycle_group !== 'AB') {
    throw new Error(`Expected 2026-06-24 to be AB, got ${ab.plan.cycle_group}.`);
  }

  if (cd.plan.cycle_group !== 'CD') {
    throw new Error(`Expected 2026-07-01 to be CD, got ${cd.plan.cycle_group}.`);
  }

  await mkdir(dirname(storePaths.updatesPath), { recursive: true });
  await writeFile(
    storePaths.updatesPath,
    `updates:
  - meeting_date: 2026-06-24
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
  const legacyUpdate = await buildThemeMeetingPlan({ ...storePaths, meetingDate: '2026-06-24' });
  const legacyThemeA = legacyUpdate.plan.meetings.find((meeting) => meeting.theme_id === 'A');
  if (!legacyThemeA?.agenda_items.some((item) => item.member === 'Alice' && item.update_type === 'milestone_check')) {
    throw new Error('Expected legacy short_update to load as milestone_check.');
  }

  await submitThemeMeetingUpdate({
    ...storePaths,
    meetingDate: '2026-06-24',
    themeId: 'A',
    member: 'Alice',
    updateType: 'milestone_check',
    progressText: 'Finished the first experiment pass and will show the current result table.',
    submittedVia: 'api',
    now: new Date('2026-06-22T08:00:00.000Z'),
  });

  const afterUpdate = await buildThemeMeetingPlan({ ...storePaths, meetingDate: '2026-06-24' });
  const themeA = afterUpdate.plan.meetings.find((meeting) => meeting.theme_id === 'A');

  if (!themeA?.agenda_items.some((item) => item.member === 'Alice' && item.update_type === 'milestone_check' && item.duration_minutes === 10)) {
    throw new Error('Expected Alice milestone check to appear in Theme A agenda.');
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

  await submitThemeMeetingUpdate({
    ...storePaths,
    meetingDate: '2026-06-24',
    themeId: 'A',
    member: 'Bob',
    updateType: 'nothing_to_report',
    progressText: 'Nothing to report this cycle.',
    submittedVia: 'api',
  });

  const afterNothing = await buildThemeMeetingPlan({ ...storePaths, meetingDate: '2026-06-24' });
  const themeAAfterNothing = afterNothing.plan.meetings.find((meeting) => meeting.theme_id === 'A');
  if (!themeAAfterNothing?.agenda_items.some((item) => item.member === 'Bob' && item.update_type === 'nothing_to_report' && item.duration_minutes === 0)) {
    throw new Error('Expected Bob nothing-to-report update to appear with zero planned minutes.');
  }
  if (themeAAfterNothing?.planned_minutes !== 10) {
    throw new Error(`Expected Theme A planned minutes to remain 10, got ${themeAAfterNothing?.planned_minutes}.`);
  }

  const manualReminder = await buildThemeMeetingReminderRun('manual_missing_update_reminder', {
    ...storePaths,
    meetingDate: '2026-06-24',
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

  await cleanupSmokeFiles();
}

main()
  .finally(cleanupSmokeFiles)
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
