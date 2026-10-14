import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import nodemailer from 'nodemailer';
import { renderThemeMeetingAgendaEmail } from '../src/mastra/theme-meetings/agenda-email';
import { themeMeetingPlanSchema } from '../src/mastra/theme-meetings/schema';

const meeting = {
  theme_id: 'A', title: 'Example research theme', time: '10:00', duration_minutes: 60,
  coordinator: 'Example coordinator', members: ['Example member', 'Another member'],
  submitted_members: ['Example member'], missing_members: ['Another member'],
  planned_minutes: 10, overbooked: false,
  agenda_items: [{
    meeting_date: '2026-10-14', theme_id: 'A', theme_title: 'Example research theme',
    member: 'Example member', update_type: 'milestone_check', duration_minutes: 10,
    progress_text: '- Finished the draft & shared the results.\n- Next: compare <baseline> with the revised method.',
    questions: 'Which result should lead?\nAre additional comparisons useful?',
    submitted_at: '2026-10-12T09:00:00Z',
  }],
};
const plan = themeMeetingPlanSchema.parse({
  meeting_date: '2026-10-14', timezone: 'Europe/London', cycle_group: 'AB',
  generated_at: '2026-10-13T12:00:00Z',
  meetings: [meeting, {
    ...meeting, theme_id: 'B', time: '11:00', planned_minutes: 0, missing_members: [],
    agenda_items: [{ ...meeting.agenda_items[0], theme_id: 'B', questions: '', update_type: 'nothing_to_report', duration_minutes: 0 }],
  }, { ...meeting, theme_id: 'C', cancelled: true }],
});
const email = renderThemeMeetingAgendaEmail(plan);
assert.match(email.html, /<h1[^>]*>Theme meeting agenda<\/h1>/);
assert.match(email.html, /Theme A &mdash;/);
assert.match(email.html, /Theme B &mdash;/);
assert.doesNotMatch(email.html, /Theme C &mdash;|<script>|milestone_check|nothing_to_report/);
assert.match(email.html, /draft &amp; shared/);
assert.match(email.html, /<ul[^>]*>[\s\S]*<li[^>]*>Finished the draft/);
assert.match(email.html, /<li[^>]*>Next:/);
assert.match(email.html, /&lt;baseline&gt;/);
const unsafePlan = { ...plan, meetings: [{ ...plan.meetings[0]!, agenda_items: [{ ...plan.meetings[0]!.agenda_items[0]!, questions: '<script>alert("unsafe")</script>' }] }] };
assert.match(renderThemeMeetingAgendaEmail(unsafePlan).html, /&lt;script&gt;alert\(&quot;unsafe&quot;\)/);
assert.doesNotMatch(renderThemeMeetingAgendaEmail(unsafePlan).html, /<script>/);
assert.match(email.html, /Nothing to report &middot; 0 min/);
assert.match(email.html, /<th scope="col"[^>]*>Member<\/th>/);
assert.match(email.html, /Discussion details/);
assert.match(email.html, />Updates<\/h3>/);
assert.doesNotMatch(email.html, /Written updates/);
assert.match(email.html, /No discussion slots requested/);
assert.equal((email.html.match(/<thead>/g) || []).length, 1, 'Zero-minute updates do not occupy the discussion table.');
assert.match(email.html, /Missing updates: None/);
assert.match(email.text, /Milestone check \(10 min\)/);
assert.match(email.text, /results\.\n• Next:/);
assert.doesNotMatch(email.text, /^#|milestone_check|nothing_to_report/m);
assert.match(email.text, /advisory until confirmed/);
assert.match(renderThemeMeetingAgendaEmail({ ...plan, meetings: [] }).html, /No active theme meetings/);
assert.match(renderThemeMeetingAgendaEmail({ ...plan, meetings: [{ ...plan.meetings[0]!, agenda_items: [], overbooked: true }] }).html, /\(overbooked\)/);
assert.match(renderThemeMeetingAgendaEmail({ ...plan, meetings: [{ ...plan.meetings[0]!, agenda_items: [] }] }).text, /No planned updates yet/);

const singleUpdate = (progress: string) => renderThemeMeetingAgendaEmail({
  ...plan, meetings: [{ ...plan.meetings[0]!, agenda_items: [{ ...plan.meetings[0]!.agenda_items[0]!, progress_text: progress, questions: '' }] }],
});
for (const progress of [
  'A mix of things: a) Finished the draft; b) Reviewed the results; c) Planning the next experiment.',
  '1. Finished the draft; 2. Reviewed the results; 3. Planning the next experiment.',
  '1) Finished the draft\n2) Reviewed the results\n3) Planning the next experiment.',
  '-Finished the draft\r\n-Reviewed the results\r\n-Planning the next experiment.',
  '* Finished the draft\n• Reviewed the results\n- Planning the next experiment.',
]) {
  const formatted = singleUpdate(progress);
  assert.equal((formatted.html.match(/<li /g) || []).length, 3, progress);
  assert.equal((formatted.text.match(/^• /gm) || []).length, 3, progress);
}
const prose = 'The pre-submission draft uses version 1.5 on 2026-10-14; compare A-B and 10. Results remain advisory.';
assert.ok(singleUpdate(prose).text.includes(prose));
assert.doesNotMatch(singleUpdate(prose).html, /<li /);
assert.ok(singleUpdate('- First item\ncontinued on the next line\n- Second item').html.includes('First item<br>continued on the next line'));

const orderedPlan = { ...plan, meetings: [{ ...plan.meetings[0]!, agenda_items: [
  { ...plan.meetings[0]!.agenda_items[0]!, member: 'Milestone member' },
  { ...plan.meetings[0]!.agenda_items[0]!, member: 'Short deep dive', update_type: 'deep_dive' as const, duration_minutes: 20 },
  { ...plan.meetings[0]!.agenda_items[0]!, member: 'Strategy member', update_type: 'strategic_slot' as const },
  { ...plan.meetings[0]!.agenda_items[0]!, member: 'Long deep dive', update_type: 'deep_dive' as const, duration_minutes: 30 },
] }] };
const before = JSON.stringify(orderedPlan);
const ordered = renderThemeMeetingAgendaEmail(orderedPlan);
for (const output of [ordered.html, ordered.text]) {
  assert.ok(output.indexOf('Long deep dive') < output.indexOf('Short deep dive'));
  assert.ok(output.indexOf('Short deep dive') < output.indexOf('Milestone member'));
  assert.ok(output.indexOf('Milestone member') < output.indexOf('Strategy member'));
  assert.ok(output.lastIndexOf('Short deep dive') < output.lastIndexOf('Milestone member'));
}
assert.equal(JSON.stringify(orderedPlan), before, 'Rendering does not reorder stored updates.');
assert.equal((ordered.html.match(/consider skipping/g) || []).length, 0);
assert.equal((email.html.match(/consider skipping/g) || []).length, 1);
assert.match(email.html, /confirmation is required; the meeting remains scheduled/);
assert.match(renderThemeMeetingAgendaEmail({ ...plan, meetings: [{ ...plan.meetings[0]!, agenda_items: [] }] }).html, /Some updates are missing; check with those members first/);

// Compose locally: no SMTP, account DB, datastore, or real recipients involved.
const transport = nodemailer.createTransport({ streamTransport: true, buffer: true });
const composed = await transport.sendMail({ from: 'sender@example.test', to: 'reader@example.test', subject: 'Agenda preview', ...email });
const mime = composed.message.toString();
assert.match(mime, /multipart\/alternative/);
assert.match(mime, /Content-Type: text\/plain/);
assert.match(mime, /Content-Type: text\/html/);

const previewPath = process.argv[2];
if (previewPath) await writeFile(previewPath, email.html);
console.log('Theme agenda email checks passed (HTML, plain text, escaping, multiline updates, MIME).');
