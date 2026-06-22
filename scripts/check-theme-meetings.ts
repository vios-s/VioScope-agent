import 'dotenv/config';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildThemeMeetingPlan,
  buildThemeMeetingReminderRun,
  submitThemeMeetingUpdate,
} from '../src/mastra/theme-meetings/planner';
import { managedThemeIdsForUser, visiblePlanForUser } from '../src/mastra/theme-meetings/access';
import type { AuthUser } from '../src/mastra/db/users';

const storePaths = {
  configPath: 'fixtures/theme-meeting-config.example.yaml',
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
    provisioningStatus: 'active',
    sourceProfileId: null,
    aliases: [],
    passwordResetRequired: false,
    passwordChangedAt: null,
    lastLoginAt: null,
  };
}

async function cleanupSmokeFiles() {
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

  await submitThemeMeetingUpdate({
    ...storePaths,
    meetingDate: '2026-06-24',
    themeId: 'A',
    member: 'Alice',
    updateType: 'short_update',
    progressText: 'Finished the first experiment pass and will show the current result table.',
    questions: 'Can the group suggest one more baseline?',
    submittedVia: 'api',
    now: new Date('2026-06-22T08:00:00.000Z'),
  });

  const afterUpdate = await buildThemeMeetingPlan({ ...storePaths, meetingDate: '2026-06-24' });
  const themeA = afterUpdate.plan.meetings.find((meeting) => meeting.theme_id === 'A');

  if (!themeA?.agenda_items.some((item) => item.member === 'Alice' && item.duration_minutes === 10)) {
    throw new Error('Expected Alice short update to appear in Theme A agenda.');
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

  let rejectedMissingQuestions = false;
  try {
    await submitThemeMeetingUpdate({
      ...storePaths,
      meetingDate: '2026-06-24',
      themeId: 'A',
      member: 'Bob',
      updateType: 'deep_dive',
      progressText: 'Need to discuss a blocker in the model design.',
      submittedVia: 'api',
    });
  } catch {
    rejectedMissingQuestions = true;
  }

  if (!rejectedMissingQuestions) {
    throw new Error('Expected deep dive without questions to be rejected.');
  }

  const manualReminder = await buildThemeMeetingReminderRun('manual_missing_update_reminder', {
    ...storePaths,
    meetingDate: '2026-06-24',
    themeId: 'A',
    now: new Date('2026-06-23T10:00:00.000Z'),
  });

  if (manualReminder.notifications.length !== 1 || manualReminder.notifications[0]?.member !== 'Bob') {
    throw new Error('Expected manual reminder to target only missing Theme A members.');
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
