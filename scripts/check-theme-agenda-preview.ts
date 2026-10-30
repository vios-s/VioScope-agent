import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import nodemailer from 'nodemailer';
import { stringify } from 'yaml';
import { closePostgresPools, createPostgresClient } from '../src/mastra/db/postgres';

const originalURL = process.env.DATABASE_URL!;
assert.ok(originalURL, 'DATABASE_URL is required.');
const source = createPostgresClient('agenda-preview-test-isolation');
const database = `vioscope_agenda_preview_${randomUUID().replaceAll('-', '')}`;
const directory = await mkdtemp(join(tmpdir(), 'vioscope-agenda-preview-'));
const originalTransport = nodemailer.createTransport;
const sent: { to: string; subject: string; text: string; html: string }[] = [];
let created = false;
let db: ReturnType<typeof createPostgresClient> | undefined;
try {
  await source.pool.query(`CREATE DATABASE "${database}"`);
  created = true;
  const url = new URL(originalURL);
  url.pathname = `/${database}`;
  Object.assign(process.env, {
    DATABASE_URL: url.toString(), DATASTORE_DIR: directory, AUTH_SECRET: 'isolated-agenda-preview-check',
    VIOSCOPE_RUNTIME_CONFIG_CACHE_PATH: join(directory, 'runtime.json'),
    EMAIL_NOTIFICATIONS_ENABLED: 'true', EMAIL_SEND_PROVIDER: 'smtp',
    THEME_MEETING_CONFIG_PATH: join(directory, 'config.yaml'),
    THEME_MEETING_UPDATES_PATH: join(directory, 'updates.yaml'),
    THEME_MEETING_NOTIFICATIONS_PATH: join(directory, 'notifications.yaml'),
    THEME_MEETING_CANCELLATIONS_PATH: join(directory, 'cancellations.yaml'),
    THEME_MEETING_EMAIL_DELIVERIES_PATH: join(directory, 'deliveries.yaml'),
  });
  nodemailer.createTransport = (() => ({ sendMail: async (mail: typeof sent[number]) => {
    sent.push(mail);
    return { messageId: `<preview-${sent.length}@example.test>`, accepted: [mail.to], rejected: [] };
  } })) as unknown as typeof nodemailer.createTransport;
  const users = await import('../src/mastra/db/users');
  const subscriptions = await import('../src/mastra/db/theme-agenda-subscriptions');
  const schema = await import('../src/mastra/theme-meetings/schema');
  const planner = await import('../src/mastra/theme-meetings/planner');
  const { themeAgendaPreviewRecipients } = await import('../src/mastra/theme-meetings/agenda-recipients');
  const { renderThemeMeetingAgendaEmail } = await import('../src/mastra/theme-meetings/agenda-email');
  const { createSessionToken, sessionCookieName } = await import('../src/mastra/auth/session');
  const reminderRoute = await import('../app/api/theme-meetings/reminders/route');
  await users.ensureUsersTable();
  db = createPostgresClient('agenda-preview-check');
  for (const [username, role] of [
    ['member.c', 'member'], ['member.d', 'member'], ['muted.c', 'member'],
    ['pi.only', 'pi'], ['admin.member.d', 'administrator'], ['coordinator.only', 'organizer'], ['observer', 'member'],
  ]) await db.pool.query(`INSERT INTO users(id,username,display_name,email,role,provisioning_status,source,password_reset_required)
    VALUES($1,$2,$2,$3,$4,'active','synthetic_preview_check',false)`, [randomUUID(), username, `${username}@example.test`, role]);
  const observer = (await users.getUserByUsername('observer'))!;
  const coordinator = (await users.getUserByUsername('coordinator.only'))!;
  await subscriptions.setThemeAgendaSubscription(observer.id, 'C', true);
  await db.pool.query(`UPDATE users SET metadata = '{"notification_preferences":{"theme_meeting_reminders":{"email":false}}}'::jsonb WHERE username='muted.c'`);
  const config = schema.themeMeetingConfigSchema.parse({
    timezone: 'Europe/London', cycle: { rotation: ['CD'], anchor_date: '2026-10-21' },
    pi_users: ['pi.only'], administrator_user: 'admin.member.d',
    reminders: [{ name: 'agenda_preview', weekday: 'Tuesday', time: '13:00' }, { name: 'agenda_cutoff', weekday: 'Wednesday', time: '08:00' }],
    themes: [
      { theme_id: 'C', title: 'Example C', cycle_group: 'CD', time: '10:00', coordinator: 'coordinator.only', coordinator_user: 'coordinator.only', members: ['member.c', 'muted.c'], member_users: ['member.c', 'muted.c'] },
      { theme_id: 'D', title: 'Example D', cycle_group: 'CD', time: '11:00', coordinator: 'member.d', coordinator_user: 'member.d', members: ['member.d', 'admin.member.d'], member_users: ['member.d', 'admin.member.d'] },
    ],
  });
  await writeFile(process.env.THEME_MEETING_CONFIG_PATH!, stringify(config));
  const date = '2026-10-28';
  await planner.submitThemeMeetingUpdate({ meetingDate: date, themeId: 'C', member: 'member.c', updateType: 'deep_dive', progressText: 'Draft experiment results for group discussion.', now: new Date('2026-10-27T12:00:00Z') });
  const originalUpdates = await readFile(process.env.THEME_MEETING_UPDATES_PATH!, 'utf8');
  const originalConfig = await readFile(process.env.THEME_MEETING_CONFIG_PATH!, 'utf8');
  assert.equal(schema.themeReminderActionSchema.parse('agenda_preview'), 'agenda_preview');
  const run = await planner.buildThemeMeetingReminderRun('agenda_preview', { meetingDate: date, now: new Date('2026-10-27T13:00:00Z') });
  assert.deepEqual(run.notifications, [], 'Preview is not a missing-update reminder.');
  await assert.rejects(readFile(process.env.THEME_MEETING_NOTIFICATIONS_PATH!), /ENOENT/);
  assert.equal(await readFile(process.env.THEME_MEETING_UPDATES_PATH!, 'utf8'), originalUpdates);
  assert.equal(await readFile(process.env.THEME_MEETING_CONFIG_PATH!, 'utf8'), originalConfig);
  const recipients = themeAgendaPreviewRecipients(run.plan);
  assert.equal(recipients.has('observer'), false, 'Subscribers are excluded from the preview.');
  assert.equal(recipients.has('pi.only'), false, 'PI role does not grant draft delivery.');
  assert.equal(recipients.has('coordinator.only'), false, 'Coordinator role alone does not expand the member-only audience.');
  assert.deepEqual(recipients.get('admin.member.d')!.meetings.map((meeting) => meeting.theme_id), ['D']);
  assert.deepEqual(themeAgendaPreviewRecipients(run.plan, 'D').get('member.d')!.meetings.map((meeting) => meeting.theme_id), ['D']);
  const cancelled = { ...run.plan, meetings: run.plan.meetings.map((meeting) => ({ ...meeting, cancelled: meeting.theme_id === 'D' })) };
  assert.equal(themeAgendaPreviewRecipients(cancelled).has('admin.member.d'), false);
  const beforePlan = JSON.stringify(run.plan);
  const preview = await planner.sendThemeMeetingAgendaEmails(run.plan, run.config, { phase: 'preview' });
  assert.equal(preview.sent, 3);
  assert.equal(preview.failed, 0);
  assert.deepEqual(sent.map((mail) => mail.to).sort(), ['admin.member.d@example.test', 'member.c@example.test', 'member.d@example.test']);
  const memberPreview = sent.find((mail) => mail.to === 'member.c@example.test')!;
  assert.match(memberPreview.subject, /^\[DRAFT\]/);
  assert.match(memberPreview.html, /DRAFT AGENDA PREVIEW/);
  assert.match(memberPreview.text, /Wednesday 08:00 \(Europe\/London\)/);
  assert.match(memberPreview.text, /Deep Dive \| 30 min/);
  assert.match(memberPreview.html, /Deep Dive/);
  assert.doesNotMatch(memberPreview.html, /Theme D &mdash;/);
  assert.match(memberPreview.text, /Not submitted yet: muted.c/);
  assert.match(sent.find((mail) => mail.to === 'member.d@example.test')!.text, /Submissions are still open/);
  assert.doesNotMatch(sent.map((mail) => mail.text).join('\n'), /consider skipping/);
  assert.equal(JSON.stringify(run.plan), beforePlan);
  assert.equal((await planner.sendThemeMeetingAgendaEmails(run.plan, run.config, { phase: 'preview' })).sent, 0);
  assert.equal(sent.length, 3);

  await planner.submitThemeMeetingUpdate({ meetingDate: date, themeId: 'C', member: 'member.c', updateType: 'short_update', progressText: 'Adjusted presentation after reviewing the draft agenda.', now: new Date('2026-10-27T15:00:00Z') });
  const finalPlan = (await planner.buildThemeMeetingPlan({ meetingDate: date })).plan;
  const final = await planner.sendThemeMeetingAgendaEmails(finalPlan, config);
  assert.equal(final.sent, 6, 'The draft receipt must not suppress final circulation.');
  assert.equal(final.failed, 0);
  const memberFinal = sent.filter((mail) => mail.to === 'member.c@example.test').at(-1)!;
  assert.doesNotMatch(memberFinal.subject, /DRAFT/);
  assert.match(memberFinal.text, /Update \| 5 min/);
  assert.match(memberFinal.text, /Adjusted presentation/);
  assert.match(memberPreview.text, /Draft experiment results/);
  assert.match(sent.find((mail) => mail.to === 'observer@example.test')!.text, /Theme C —/);
  assert.doesNotMatch(sent.find((mail) => mail.to === 'observer@example.test')!.text, /Theme D —/);
  const piFinal = sent.find((mail) => mail.to === 'pi.only@example.test')!;
  assert.match(piFinal.text, /Theme C —/);
  assert.match(piFinal.text, /Theme D —/);
  assert.equal((await planner.sendThemeMeetingAgendaEmails(finalPlan, config)).sent, 0);
  assert.equal((await planner.sendThemeMeetingAgendaEmails(finalPlan, config, { phase: 'preview' })).sent, 0);

  const beforeApi = sent.length;
  const request = (actor: typeof coordinator, action: string) => new Request('http://localhost/api/theme-meetings/reminders', {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: `${sessionCookieName}=${createSessionToken(actor)}` },
    body: JSON.stringify({ action, themeId: 'C', meetingDate: '2026-11-04' }),
  });
  assert.equal((await reminderRoute.POST(request(observer, 'agenda_preview'))).status, 403);
  const api = await reminderRoute.POST(request(coordinator, 'agenda_preview'));
  assert.equal(api.status, 200, await api.clone().text());
  const body = await api.json();
  assert.equal(body.notificationCount, 0);
  assert.deepEqual(body.recipients, []);
  assert.equal(body.agendaEmails.sent, 1);
  assert.equal(sent.length, beforeApi + 1);
  assert.match(sent.at(-1)!.subject, /^\[DRAFT\]/);
  await assert.rejects(readFile(process.env.THEME_MEETING_NOTIFICATIONS_PATH!), /ENOENT/);
  const emptyDraft = renderThemeMeetingAgendaEmail(cancelled, { phase: 'preview', cutoff: { weekday: 'Wednesday', time: '08:00' } });
  assert.doesNotMatch(emptyDraft.html, /Theme D &mdash;/);
  console.log('Agenda preview passed: strict member-only audience, submitted members included, draft labels/deadline, no cutoff side effects, editable updates, independent preview/final deduplication, final subscribers/PI scope, permissions, mute and cancellation. No external mail sent.');
} finally {
  nodemailer.createTransport = originalTransport;
  await db?.disconnect();
  await closePostgresPools(process.env.DATABASE_URL);
  if (created) await source.pool.query(`DROP DATABASE "${database}" WITH (FORCE)`);
  await source.disconnect();
  await rm(directory, { recursive: true, force: true });
}
process.exit(0);
