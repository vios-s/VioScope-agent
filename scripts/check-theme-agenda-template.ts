import assert from 'node:assert/strict';
import { defaultAgenda } from '../src/mastra/theme-meetings/agenda-template';
import { themeMeetingPlanSchema, themeMeetingUpdateSchema } from '../src/mastra/theme-meetings/schema';
import { confirmAgenda, applyConfirmedAgendas, agendaSourceVersion, type MeetingWorkflow } from '../src/mastra/theme-meetings/workflow';
import { renderThemeMeetingAgendaEmail } from '../src/mastra/theme-meetings/agenda-email';

const date = '2026-11-04';
const base = { meeting_date: date, theme_id: 'A', theme_title: 'Synthetic theme', progress_text: 'Recorded evidence.', questions: '', submitted_at: '2026-10-30T12:00:00Z' };
const items = defaultAgenda([
  { ...base, member: 'Alice', member_username: 'alice', update_type: 'short_update', duration_minutes: 5 },
  { ...base, member: 'Bob', member_username: 'bob', update_type: 'deep_dive', duration_minutes: 30 },
  { ...base, member: 'Carol', member_username: 'carol', update_type: 'deep_dive', duration_minutes: 30 },
], date, 'A', 'Synthetic theme');
assert.deepEqual(items.map((item) => item.member_username), [':triage_admin', 'bob', 'carol', 'alice', ':assignments']);
assert.equal(items.reduce((sum, item) => sum + item.duration_minutes, 0), 75);
assert.deepEqual(defaultAgenda([], date, 'A', 'Synthetic theme').map((item) => item.duration_minutes), [5, 5]);
assert.deepEqual(defaultAgenda([], date, 'A', 'Synthetic theme'), defaultAgenda([], date, 'A', 'Synthetic theme'));
for (const item of items.filter((item) => item.member_username?.startsWith(':'))) {
  assert.equal(themeMeetingUpdateSchema.safeParse(item).success, false, 'Placeholders cannot be submitted as member updates.');
}
const plan = themeMeetingPlanSchema.parse({ meeting_date: date, timezone: 'Europe/London', cycle_group: 'AB', generated_at: base.submitted_at,
  meetings: [{ theme_id: 'A', title: 'Synthetic theme', time: '10:00', duration_minutes: 60, coordinator: 'Chair', members: ['Alice', 'Bob', 'Carol'], member_usernames: ['alice', 'bob', 'carol'], submitted_members: ['Alice', 'Bob', 'Carol'], missing_members: [], agenda_items: items, planned_minutes: 75, overbooked: true }] });
const meeting = plan.meetings[0];
const state: MeetingWorkflow = { confirmations: [], actions: [] };
const selections = items.map((item) => ({ username: item.member_username!, minutes: item.duration_minutes, deferred: false }));
assert.throws(() => confirmAgenda(state, meeting, date, selections, 'chair'), /exceeds the meeting time/);
assert.throws(() => confirmAgenda(state, meeting, date, selections.slice(1), 'chair'), /exactly once/);
const arranged = [...selections].reverse().map((item) => ({ ...item, minutes: item.username === 'alice' ? 7 : ['bob', 'carol'].includes(item.username) ? 20 : 6 }));
const before = agendaSourceVersion(meeting, null);
const confirmation = confirmAgenda(state, meeting, date, arranged, 'chair');
assert.equal(confirmation.entries.reduce((sum, item) => sum + item.duration_minutes, 0), 59);
assert.equal(confirmation.entries[0].update_type, 'assignments', 'Coordinator order overrides the default.');
assert.notEqual(agendaSourceVersion(meeting, confirmation), before);
assert.throws(() => confirmAgenda(state, meeting, date, arranged.map((item) => item.username === 'alice' ? { ...item, minutes: 8 } : item), 'chair'), /5–7 minutes/);
const confirmedPlan = applyConfirmedAgendas(plan, state);
assert.deepEqual(confirmedPlan.meetings[0].agenda_items.map((item) => item.member_username), arranged.map((item) => item.username));
const email = renderThemeMeetingAgendaEmail(confirmedPlan, { confirmation: { ...confirmation, skipped: [] } });
assert.match(email.text, /10:00 \| Assignments/);
assert.match(email.text, /Triage & Admin/);
const emptyPlan = { ...plan, meetings: [{ ...meeting, agenda_items: defaultAgenda([], date, 'A', meeting.title), planned_minutes: 10, overbooked: false }] };
assert.match(renderThemeMeetingAgendaEmail(emptyPlan).text, /No planned updates yet/);
assert.match(renderThemeMeetingAgendaEmail(emptyPlan).html, /consider skipping/);
// A historical confirmed snapshot is never retrofitted with the new template.
const legacy: MeetingWorkflow = { confirmations: [{ ...confirmation, entries: confirmation.entries.filter((item) => !item.member_username?.startsWith(':')) }], actions: [] };
assert.equal(applyConfirmedAgendas(plan, legacy).meetings[0].agenda_items.length, 3);
assert.equal(state.confirmations.length, 1, 'Rejected edits add no saved versions.');
console.log('Agenda template passed: placeholders, ordering, budget, coordinator edits, invalid inputs, email and historical snapshots.');
