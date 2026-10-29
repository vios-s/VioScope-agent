import 'dotenv/config';
import assert from 'node:assert/strict';
import { themeMeetingConfigSchema, themeMeetingUpdateSchema, themeMeetingUpdatesFileSchema, themeMeetingPlanSchema, themeUpdateTypeSchema } from '../src/mastra/theme-meetings/schema';
import { formatMeetingProject, meetingProjectContext } from '../src/mastra/theme-meetings/project-context';
import { renderThemeMeetingAgendaEmail } from '../src/mastra/theme-meetings/agenda-email';
import { confirmAgenda } from '../src/mastra/theme-meetings/workflow';
import { saveThemeMeetingUpdate } from '../src/mastra/theme-meetings/store';
import { closePostgresPools } from '../src/mastra/db/postgres';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

assert.deepEqual(themeUpdateTypeSchema.options, ['deep_dive', 'short_update', 'nothing_to_report']);
const config = themeMeetingConfigSchema.parse({
  cycle: { rotation: ['AB'], anchor_date: '2026-10-28' },
  themes: [{ theme_id: 'A', title: 'Synthetic theme', cycle_group: 'AB', time: '10:00', coordinator: 'chair', members: ['alice'] }],
  submission: { update_types: { milestone_check: { duration_minutes: 10 }, strategic_slot: { duration_minutes: 10 } } },
});
assert.deepEqual(Object.keys(config.submission.update_types).sort(), ['deep_dive', 'nothing_to_report', 'short_update']);
assert.equal(config.submission.update_types.short_update.duration_minutes, 5);
const project = { id: '00000000-0000-4000-8000-000000000001', title: 'Synthetic project', ownerUsername: 'alice', stage: 3, todos: [] };
const snapshot = meetingProjectContext(project);
const base = { meeting_date: '2026-10-28', theme_id: 'A', member: 'alice', member_username: 'alice',
  progress_text: 'Recorded evidence.', questions: '', submitted_at: '2026-10-27T12:00:00Z', project_context: snapshot };
for (const [legacy, current] of [['milestone_check', 'short_update'], ['strategic_slot', 'deep_dive']]) {
  assert.equal(themeMeetingUpdateSchema.safeParse({ ...base, update_type: legacy }).success, false);
  const saved = themeMeetingUpdatesFileSchema.parse({ updates: [{ ...base, update_type: legacy }] });
  assert.equal(saved.updates[0].update_type, current);
  const historicalAgenda = themeMeetingPlanSchema.shape.meetings.element.shape.agenda_items.element.parse({ ...base, theme_title: 'Synthetic theme', update_type: legacy, duration_minutes: 10 });
  assert.equal(historicalAgenda.update_type, current);
  assert.equal(historicalAgenda.duration_minutes, 10, 'Reading historical confirmed entries preserves their duration.');
}
for (const type of themeUpdateTypeSchema.options) {
  const update = themeMeetingUpdateSchema.parse({ ...base, update_type: type });
  assert.equal(update.update_type, type);
  assert.equal(update.project_context!.stage, 3);
}
const { stage: _, ...oldContext } = snapshot;
assert.match(formatMeetingProject(oldContext), /Project stage: Not recorded/);
assert.equal(themeMeetingUpdateSchema.parse({ ...base, project_context: oldContext, update_type: 'short_update' }).project_context!.stage, undefined);
assert.equal(themeMeetingUpdateSchema.parse({ ...base, project_context: undefined, update_type: 'nothing_to_report' }).project_context, undefined);
for (const stage of [0, 6, 2.5]) assert.equal(themeMeetingUpdateSchema.safeParse({ ...base, project_context: { ...snapshot, stage }, update_type: 'short_update' }).success, false);
const plan = themeMeetingPlanSchema.parse({
  meeting_date: base.meeting_date, timezone: 'Europe/London', cycle_group: 'AB', generated_at: base.submitted_at,
  meetings: [{ ...config.themes[0], submitted_members: ['alice'], missing_members: [], planned_minutes: 5, overbooked: false,
    agenda_items: [{ ...base, theme_title: 'Synthetic theme', update_type: 'short_update', duration_minutes: 5 }] }],
});
const state = { confirmations: [], actions: [] };
const confirmed = confirmAgenda(state, plan.meetings[0], base.meeting_date, [{ username: 'alice', minutes: 5, deferred: false }], 'chair');
assert.throws(() => confirmAgenda(state, plan.meetings[0], base.meeting_date, [{ username: 'alice', minutes: 10, deferred: false }], 'chair'), /5 minutes/);
project.stage = 4;
assert.equal(snapshot.stage, 3);
assert.equal(confirmed.entries[0].project_context!.stage, 3);
assert.equal(meetingProjectContext(project).stage, 4);
const email = renderThemeMeetingAgendaEmail(plan);
assert.match(email.html, /Update &middot; 5 min/);
assert.match(email.text, /Update \(5 min\)/);
assert.match(email.html, /Project stage: 3/);
assert.match(email.text, /Project stage: 3/);
// Saving one member's update must not rewrite another member's stored legacy record.
const storeDir = await mkdtemp(join(tmpdir(), 'theme-legacy-'));
const updatesPath = join(storeDir, 'updates.yaml');
await writeFile(updatesPath, `updates:\n  - meeting_date: "2026-10-14"\n    theme_id: A\n    member: Legacy Member\n    member_username: legacy\n    update_type: milestone_check\n    progress_text: Old record.\n    submitted_at: "2026-10-13T12:00:00Z"\n    legacy_note: kept\n`);
const savedFile = await saveThemeMeetingUpdate(themeMeetingUpdateSchema.parse({ ...base, update_type: 'deep_dive' }), { updatesPath });
assert.equal(savedFile.updates.find((item) => item.member_username === 'legacy')!.update_type, 'short_update', 'Legacy types are still read as Update.');
const rawStore = await readFile(updatesPath, 'utf8');
assert.match(rawStore, /update_type: milestone_check/, 'Stored legacy type is preserved.');
assert.match(rawStore, /legacy_note: kept/, 'Unknown stored keys are preserved.');
assert.match(rawStore, /update_type: deep_dive/);
await rm(storeDir, { recursive: true, force: true });
await closePostgresPools(process.env.DATABASE_URL);
console.log('Three meeting types, legacy reads, stage snapshots, immutable confirmation and agenda rendering verified.');
