import assert from 'node:assert/strict';
import { defaultAgenda } from '../src/mastra/theme-meetings/agenda-template';
import { themeMeetingConfigSchema, themeMeetingPlanSchema, themeMeetingUpdateSchema } from '../src/mastra/theme-meetings/schema';
import { canManageTheme } from '../src/mastra/theme-meetings/access';
import { isThemeAgendaSubscriptionRequired } from '../src/mastra/theme-meetings/agenda-recipients';
import { confirmAgenda, applyConfirmedAgendas, agendaSourceVersion, type MeetingWorkflow } from '../src/mastra/theme-meetings/workflow';
import { renderThemeMeetingAgendaEmail } from '../src/mastra/theme-meetings/agenda-email';

const date = '2026-11-04';
const coordinatorConfig = themeMeetingConfigSchema.parse({ cycle: { rotation: ['AB'], anchor_date: date }, themes: [
  { theme_id: 'A', title: 'Theme A', cycle_group: 'AB', time: '10:00', coordinator: 'Chair', coordinator_user: 'chair', additional_coordinator_users: ['cochair'], members: ['Chair', 'Co-chair'], member_users: ['chair', 'cochair'] },
  { theme_id: 'B', title: 'Theme B', cycle_group: 'AB', time: '11:00', coordinator: 'Other', coordinator_user: 'other', members: ['Other'], member_users: ['other'] },
] });
assert.equal(canManageTheme(coordinatorConfig, 'A', { username: 'cochair', role: 'member' } as any), true);
assert.equal(canManageTheme(coordinatorConfig, 'B', { username: 'cochair', role: 'member' } as any), false);
assert.equal(isThemeAgendaSubscriptionRequired(coordinatorConfig, 'A', 'cochair'), true);
const base = { meeting_date: date, theme_id: 'A', theme_title: 'Synthetic theme', progress_text: 'Recorded evidence.', questions: '', submitted_at: '2026-10-30T12:00:00Z' };
const items = defaultAgenda([
  { ...base, member: 'Alice', member_username: 'alice', update_type: 'short_update', duration_minutes: 5 },
  { ...base, member: 'Bob', member_username: 'bob', update_type: 'deep_dive', duration_minutes: 30 },
  { ...base, member: 'Carol', member_username: 'carol', update_type: 'deep_dive', duration_minutes: 30 },
], date, 'A', 'Synthetic theme');
assert.deepEqual(items.map((item) => item.member_username), [':triage_admin', 'bob', 'carol', 'alice']);
assert.equal(items.reduce((sum, item) => sum + item.duration_minutes, 0), 70);
assert.deepEqual(defaultAgenda([], date, 'A', 'Synthetic theme').map((item) => item.duration_minutes), [5]);
assert.equal(items[0].member, 'PI announcement');
assert.equal(items[0].progress_text, '');
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
const boundaryState: MeetingWorkflow = { confirmations: [], actions: [] };
const atLimit = arranged.map(item => item.username === 'alice' ? { ...item, minutes: 14 } : item);
confirmAgenda(boundaryState, meeting, date, atLimit, 'chair');
const overLimit = atLimit.map(item => item.username === 'alice' ? { ...item, minutes: 15 } : item);
assert.throws(() => confirmAgenda(boundaryState, { ...meeting, duration_minutes: 90 }, date, overLimit, 'chair'), /exceeds the meeting time/);
assert.equal(boundaryState.confirmations.length, 1);
const before = agendaSourceVersion(meeting, null);
const confirmation = confirmAgenda(state, meeting, date, arranged, 'chair');
assert.equal(confirmation.entries.reduce((sum, item) => sum + item.duration_minutes, 0), 53);
assert.equal(confirmation.entries[0].update_type, 'short_update', 'Coordinator order overrides the default.');
assert.notEqual(agendaSourceVersion(meeting, confirmation), before);
assert.throws(() => confirmAgenda(state, meeting, date, arranged.map((item) => item.username === 'alice' ? { ...item, minutes: 0 } : item), 'chair'), /Invalid slot duration/);
const confirmedPlan = applyConfirmedAgendas(plan, state);
assert.deepEqual(confirmedPlan.meetings[0].agenda_items.map((item) => item.member_username), arranged.map((item) => item.username));
const email = renderThemeMeetingAgendaEmail(confirmedPlan, { confirmation: { ...confirmation, skipped: [] } });
assert.match(email.html, />Discussion<\/th>/);
assert.match(email.text, /PI announcement \| PI \| 6 min/);
assert.doesNotMatch(email.html, /PI announcement<\/h4>[\s\S]*?<p>N\/A<\/p>[\s\S]*?<\/td><\/tr>/);
assert.match(email.text, /10:00 \| Alice/);
assert.match(email.text, /PI announcement/);
const emptyPlan = { ...plan, meetings: [{ ...meeting, agenda_items: defaultAgenda([], date, 'A', meeting.title), planned_minutes: 10, overbooked: false }] };
assert.match(renderThemeMeetingAgendaEmail(emptyPlan).text, /No planned updates yet/);
assert.match(renderThemeMeetingAgendaEmail(emptyPlan).html, /consider skipping/);
// A historical confirmed snapshot is never retrofitted with the new template.
const legacy: MeetingWorkflow = { confirmations: [{ ...confirmation, entries: confirmation.entries.filter((item) => !item.member_username?.startsWith(':')) }], actions: [] };
assert.equal(applyConfirmedAgendas(plan, legacy).meetings[0].agenda_items.length, 3);
const oldAssignment = { ...items[0], member: 'Assignments', member_username: ':assignments', update_type: 'assignments' as const, progress_text: 'Review actions.', deferred: false };
const historical: MeetingWorkflow = { confirmations: [{ ...confirmation, entries: [...confirmation.entries, oldAssignment] }], actions: [] };
assert.ok(applyConfirmedAgendas(plan, historical).meetings[0].agenda_items.some(item => item.member_username === ':assignments'), 'Historical confirmed assignments remain visible.');
assert.equal(state.confirmations.length, 1, 'Rejected edits add no saved versions.');
const guest = { username: ':speaker:00000000-0000-4000-8000-000000000001', speakerName: 'Guest speaker', speakerSummary: 'Discuss the new results.', minutes: 5, deferred: false };
const guestEntries = arranged.map(item => item.username === 'bob' ? { ...item, minutes: 15 } : item);
const withGuest = confirmAgenda(state, meeting, date, [...guestEntries, guest], 'chair');
assert.equal(withGuest.entries.at(-1)?.member, 'Guest speaker');
assert.equal(withGuest.entries.at(-1)?.duration_minutes, 5);
assert.equal(withGuest.entries.at(-1)?.progress_text, 'Discuss the new results.');
const guestEmail = renderThemeMeetingAgendaEmail(applyConfirmedAgendas(plan, state), { confirmation: { ...withGuest, skipped: [] } });
assert.match(guestEmail.text, /Discuss the new results\./);
assert.match(guestEmail.html, /Discuss the new results\./);
const revisedGuest = confirmAgenda(state, meeting, date, [...guestEntries, { ...guest, speakerSummary: 'Discuss the revised results.' }], 'chair');
assert.equal(revisedGuest.entries.at(-1)?.progress_text, 'Discuss the revised results.');
assert.equal(withGuest.entries.at(-1)?.progress_text, 'Discuss the new results.', 'Earlier confirmed summaries stay unchanged.');
assert.throws(() => confirmAgenda(state, meeting, date, guestEntries.map((item, index) => index ? item : { ...item, speakerSummary: 'Impersonated update' }), 'chair'), /Only temporary speakers/);
assert.throws(() => confirmAgenda(state, meeting, date, [...guestEntries, { ...guest, speakerSummary: Array(51).fill('word').join(' ') }], 'chair'), /50 words/);
assert.throws(() => confirmAgenda(state, meeting, date, [...guestEntries, { username: 'unrecognised', minutes: 5, deferred: false }], 'chair'), /agenda changed/);
assert.equal(confirmAgenda(state, meeting, date, guestEntries, 'chair').entries.some(item => item.member_username === guest.username), false);
console.log('Agenda template passed: placeholders, ordering, budget, coordinator edits, invalid inputs, email and historical snapshots.');
