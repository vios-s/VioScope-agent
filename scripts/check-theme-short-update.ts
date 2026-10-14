import 'dotenv/config';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { buildThemeMeetingPlan, submitThemeMeetingUpdate } from '../src/mastra/theme-meetings/planner';
import { renderThemeMeetingAgendaEmail } from '../src/mastra/theme-meetings/agenda-email';
import { themeMeetingConfigSchema, themeMeetingUpdateSchema, themeUpdateTypeSchema } from '../src/mastra/theme-meetings/schema';

const checkDir = await mkdtemp(join(tmpdir(), 'vioscope-short-update-'));
const meetingDate = '2026-06-24';
const types = ['deep_dive', 'short_update', 'milestone_check', 'strategic_slot', 'nothing_to_report'] as const;
const durations = [30, 5, 10, 10, 0];
const members = types.map((_, index) => `Synthetic member ${index + 1}`);
const options = {
  configPath: join(checkDir, 'config.yaml'),
  updatesPath: join(checkDir, 'updates.yaml'),
  notificationsPath: join(checkDir, 'notifications.yaml'),
  cancellationsPath: join(checkDir, 'cancellations.yaml'),
  now: new Date('2026-06-22T07:00:00Z'),
  meetingDate,
};

try {
  assert.deepEqual(themeUpdateTypeSchema.options, types);
  const config = themeMeetingConfigSchema.parse({
    timezone: 'Europe/London',
    cycle: { rotation: ['AB', 'CD'], anchor_date: meetingDate },
    themes: [{ theme_id: 'A', title: 'Synthetic theme', cycle_group: 'AB', time: '10:00', coordinator: 'Synthetic coordinator', members }],
    // An existing four-type config gains the new default without requiring migration.
    submission: { update_types: { milestone_check: { duration_minutes: 10 } } },
  });
  assert.equal(config.submission.update_types.short_update?.duration_minutes, 5);
  assert.equal(config.submission.update_types.short_update?.questions_required, false);
  await writeFile(options.configPath, stringify(config));

  // Only the account directory is read; all synthetic updates are written under tmpdir.
  for (const [index, updateType] of types.entries()) {
    const { update } = await submitThemeMeetingUpdate({ ...options, themeId: 'A', member: members[index]!, updateType, progressText: 'Synthetic progress for this slot.' });
    assert.equal(update.update_type, updateType);
    assert.equal(themeMeetingUpdateSchema.parse(update).update_type, updateType);
  }
  const { plan } = await buildThemeMeetingPlan(options);
  assert.equal(plan.meetings[0]?.planned_minutes, 55);
  for (const [index, type] of types.entries()) {
    assert.equal(plan.meetings[0]?.agenda_items.find((item) => item.update_type === type)?.duration_minutes, durations[index]);
  }
  const email = renderThemeMeetingAgendaEmail(plan);
  assert.match(email.html, /Short update &middot; 5 min/);
  assert.match(email.text, /Short update \(5 min\)/);
  assert.ok(email.text.indexOf('Deep dive | 30 min') < email.text.indexOf('Short update | 5 min'));
  assert.match(email.text, /Planned: 55\/60 min/);
  const resubmitted = await submitThemeMeetingUpdate({ ...options, themeId: 'A', member: members[1]!, updateType: 'short_update', progressText: 'Revised synthetic progress.' });
  assert.equal(resubmitted.plan.meetings[0]?.planned_minutes, 55);
  assert.equal(resubmitted.plan.meetings[0]?.agenda_items.filter((item) => item.member === members[1]).length, 1);
  console.log('Five slot types verified: short-update submission, stored identity, 5-minute default, agenda totals, resubmission and email.');
} finally {
  await rm(checkDir, { recursive: true, force: true });
}
process.exit(0);
