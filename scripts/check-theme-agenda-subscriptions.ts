import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import nodemailer from 'nodemailer';
import { stringify } from 'yaml';
import { createPostgresClient } from '../src/mastra/db/postgres';

// Exercise the real DB/API/delivery path with disposable users and in-memory mail only.
const originalURL = process.env.DATABASE_URL!;
assert.ok(originalURL, 'DATABASE_URL is required.');
const source = createPostgresClient('agenda-subscription-test-isolation');
const database = `vioscope_agenda_test_${randomUUID().replaceAll('-', '')}`;
const directory = await mkdtemp(join(tmpdir(), 'vioscope-agenda-subscriptions-'));
const originalTransport = nodemailer.createTransport;
const sent: { to: string; text: string; html: string }[] = [];
let created = false;
let db: ReturnType<typeof createPostgresClient> | undefined;
try {
  await source.pool.query(`CREATE DATABASE "${database}"`);
  created = true;
  const url = new URL(originalURL);
  url.pathname = `/${database}`;
  Object.assign(process.env, {
    DATABASE_URL: url.toString(), DATASTORE_DIR: directory,
    AUTH_SECRET: 'synthetic-agenda-subscription-check',
    VIOSCOPE_RUNTIME_CONFIG_CACHE_PATH: join(directory, 'runtime.json'),
    EMAIL_NOTIFICATIONS_ENABLED: 'true', EMAIL_SEND_PROVIDER: 'smtp',
    THEME_MEETING_CONFIG_PATH: join(directory, 'theme-meeting-config.yaml'),
    THEME_MEETING_UPDATES_PATH: join(directory, 'updates.yaml'),
    THEME_MEETING_NOTIFICATIONS_PATH: join(directory, 'notifications.yaml'),
    THEME_MEETING_CANCELLATIONS_PATH: join(directory, 'cancellations.yaml'),
    THEME_MEETING_EMAIL_DELIVERIES_PATH: join(directory, 'deliveries.yaml'),
  });
  nodemailer.createTransport = (() => ({ sendMail: async (mail: typeof sent[number]) => {
    sent.push(mail);
    return { messageId: `<synthetic-${sent.length}@example.test>`, accepted: [mail.to], rejected: [] };
  } })) as unknown as typeof nodemailer.createTransport;

  const users = await import('../src/mastra/db/users');
  const subscriptions = await import('../src/mastra/db/theme-agenda-subscriptions');
  const { themeMeetingConfigSchema } = await import('../src/mastra/theme-meetings/schema');
  const planner = await import('../src/mastra/theme-meetings/planner');
  const { themeAgendaRecipients, isThemeAgendaSubscriptionRequired } = await import('../src/mastra/theme-meetings/agenda-recipients');
  const { canManageTheme, visiblePlanForUser } = await import('../src/mastra/theme-meetings/access');
  const { createSessionToken, sessionCookieName } = await import('../src/mastra/auth/session');
  const route = await import('../app/api/theme-meetings/subscriptions/route');
  const meetingRoute = await import('../app/api/theme-meetings/route');
  await users.ensureUsersTable();
  db = createPostgresClient('agenda-subscription-check');
  for (const [username, role, status] of [
    ['member.c', 'member', 'active'], ['member.d', 'member', 'active'], ['test.pi', 'pi', 'active'],
    ['observer', 'member', 'active'], ['muted', 'member', 'active'],
    ['disabled', 'member', 'disabled'], ['service', 'service', 'active'],
  ]) {
    await db.pool.query(`INSERT INTO users(id, username, display_name, email, role, provisioning_status, source, password_reset_required)
      VALUES($1, $2, $2, $3, $4, $5, 'synthetic_agenda_check', false)`,
    [randomUUID(), username, `${username}@example.test`, role, status]);
  }
  const observer = (await users.getUserByUsername('observer'))!;
  const member = (await users.getUserByUsername('member.c'))!;
  const muted = (await users.getUserByUsername('muted'))!;
  const disabled = (await users.getUserByUsername('disabled'))!;
  const service = (await users.getUserByUsername('service'))!;
  const config = themeMeetingConfigSchema.parse({
    timezone: 'Europe/London', cycle: { rotation: ['CD'], anchor_date: '2026-10-21' },
    pi_users: ['test.pi'],
    themes: ['C', 'D'].map((id, index) => ({
      theme_id: id, title: `Synthetic ${id}`, cycle_group: 'CD', time: index ? '11:00' : '10:00',
      coordinator: `member.${id.toLowerCase()}`, coordinator_user: `member.${id.toLowerCase()}`,
      members: [`member.${id.toLowerCase()}`], member_users: [`member.${id.toLowerCase()}`],
    })),
  });
  await writeFile(process.env.THEME_MEETING_CONFIG_PATH!, stringify(config));
  const originalConfig = await readFile(process.env.THEME_MEETING_CONFIG_PATH!, 'utf8');
  function request(actor: typeof observer | null, body: unknown) {
    return new Request('http://localhost/api/theme-meetings/subscriptions', {
      method: 'PATCH', headers: { 'content-type': 'application/json',
        ...(actor ? { cookie: `${sessionCookieName}=${createSessionToken(actor)}` } : {}),
      }, body: JSON.stringify(body),
    });
  }
  async function subscribe(themeId: string, subscribed: boolean) {
    const response = await route.PATCH(request(observer, { themeId, subscribed }));
    assert.equal(response.status, 200, await response.text());
  }
  assert.equal((await route.PATCH(request(null, { themeId: 'C', subscribed: true }))).status, 401);
  assert.equal((await route.PATCH(request(disabled, { themeId: 'C', subscribed: true }))).status, 401);
  assert.equal((await route.PATCH(request(service, { themeId: 'C', subscribed: true }))).status, 403);
  for (const body of [
    { themeId: 'unknown', subscribed: true }, { themeId: 'C', subscribed: 'true' },
    { themeId: 'C', subscribed: true, userId: member.id },
  ]) assert.equal((await route.PATCH(request(observer, body))).status, 400);
  assert.equal((await route.PATCH(request(member, { themeId: 'C', subscribed: false }))).status, 403, 'Members cannot unsubscribe from their own theme.');
  assert.equal((await route.PATCH(request(member, { themeId: 'C', subscribed: true }))).status, 200);
  assert.deepEqual(await subscriptions.listThemeAgendaSubscriptions(member.id), [], 'Automatic membership needs no explicit subscription row.');
  const pi = (await users.getUserByUsername('test.pi'))!;
  for (const themeId of ['C', 'D']) {
    assert.equal((await route.PATCH(request(pi, { themeId, subscribed: false }))).status, 403);
  }
  assert.equal(isThemeAgendaSubscriptionRequired(config, 'C', ' MEMBER.C '), true);
  assert.equal(isThemeAgendaSubscriptionRequired(config, 'D', member.username), false);
  assert.equal(isThemeAgendaSubscriptionRequired(config, 'unknown', member.username), false);
  assert.equal(isThemeAgendaSubscriptionRequired({ ...config, administrator_user: 'test.admin' }, 'C', 'test.admin'), true);
  assert.equal(isThemeAgendaSubscriptionRequired({ ...config, themes: config.themes.map((theme) => ({ ...theme, coordinator_user: 'test.coordinator' })) }, 'C', 'test.coordinator'), true);
  await subscribe('C', true);
  await Promise.all([subscribe('C', true), subscribe('D', true)]);
  assert.deepEqual((await subscriptions.listThemeAgendaSubscriptions(observer.id)).map((row) => row.themeId), ['C', 'D']);
  assert.deepEqual(await subscriptions.listThemeAgendaSubscriptions(member.id), []);

  const { plan } = await planner.buildThemeMeetingPlan({ meetingDate: '2026-10-21', validateUsers: true });
  assert.ok(plan.meetings.every((meeting) => !meeting.member_usernames.includes(observer.username)));
  assert.ok(plan.meetings.every((meeting) => !meeting.missing_member_usernames.includes(observer.username)));
  assert.equal(canManageTheme(config, 'C', observer), false);
  assert.equal(visiblePlanForUser(plan, config, observer).meetings.length, 0);
  for (const action of ['first_reminder', 'gentle_missing_update_reminder', 'agenda_cutoff'] as const) {
    const run = await planner.buildThemeMeetingReminderRun(action, { meetingDate: plan.meeting_date, previewOnly: true });
    assert.ok(run.notifications.every((notification) => notification.member_username !== observer.username));
  }
  await assert.rejects(planner.submitThemeMeetingUpdate({
    meetingDate: plan.meeting_date, themeId: 'C', member: observer.username, updateType: 'nothing_to_report',
  }), /not configured/);
  const response = await meetingRoute.GET(new Request('http://localhost/api/theme-meetings?date=2026-10-21', {
    headers: { cookie: `${sessionCookieName}=${createSessionToken(observer)}` },
  }));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.submissionPlan, null);
  assert.equal(payload.agendaSubscriptions.filter((row: { subscribed: boolean }) => row.subscribed).length, 2);
  assert.ok(payload.agendaSubscriptions.every((row: { required: boolean }) => row.required === false));
  assert.deepEqual(payload.access.canManageThemeIds, []);
  const memberResponse = await meetingRoute.GET(new Request('http://localhost/api/theme-meetings?date=2026-10-21', {
    headers: { cookie: `${sessionCookieName}=${createSessionToken(member)}` },
  }));
  assert.equal(memberResponse.status, 200);
  const memberPayload = await memberResponse.json();
  assert.deepEqual(memberPayload.agendaSubscriptions.map((row: { theme_id: string; required: boolean; subscribed: boolean }) => [row.theme_id, row.required, row.subscribed]), [['C', true, true], ['D', false, false]]);

  const current = await subscriptions.listThemeAgendaSubscriptions();
  const recipients = themeAgendaRecipients(plan, config, current);
  assert.equal(recipients.get('observer')!.meetings.length, 2);
  assert.equal(recipients.get('test.pi')!.meetings.length, 2);
  assert.deepEqual(recipients.get('member.c')!.meetings.map((meeting) => meeting.theme_id), ['C']);
  const cancelledPlan = { ...plan, meetings: plan.meetings.map((meeting) => ({ ...meeting, cancelled: meeting.theme_id === 'D' })) };
  assert.deepEqual(themeAgendaRecipients(cancelledPlan, config, current).get('observer')!.meetings.map((meeting) => meeting.theme_id), ['C']);
  assert.equal(themeAgendaRecipients({ ...plan, meetings: [] }, config, current).size, 0);
  assert.deepEqual(themeAgendaRecipients(plan, config, current, 'D').get('observer')!.meetings.map((meeting) => meeting.theme_id), ['D']);

  await subscribe('D', false);
  await subscriptions.setThemeAgendaSubscription(muted.id, 'C', true);
  await db.pool.query(`UPDATE users SET metadata = '{"notification_preferences":{"theme_meeting_reminders":{"email":false}}}'::jsonb WHERE id = $1`, [muted.id]);
  const delivery = await planner.sendThemeMeetingAgendaEmails(plan, config);
  assert.equal(delivery.failed, 0);
  assert.equal(delivery.sent, 4); // Two members, PI, observer. Muted subscriber is skipped.
  const observerMail = sent.filter((mail) => mail.to === 'observer@example.test');
  assert.equal(observerMail.length, 1);
  assert.match(observerMail[0]!.text, /Theme C —/);
  assert.doesNotMatch(observerMail[0]!.text, /Theme D —/);
  assert.equal(sent.some((mail) => mail.to === 'muted@example.test'), false);
  assert.match(sent.find((mail) => mail.to === 'test.pi@example.test')!.text, /Theme D —/);
  assert.equal((await planner.sendThemeMeetingAgendaEmails(plan, config)).sent, 0, 'Repeated agenda jobs do not duplicate mail.');
  await subscribe('C', false);
  await subscribe('D', true);
  const nextPlan = (await planner.buildThemeMeetingPlan({ meetingDate: '2026-10-28', validateUsers: true })).plan;
  const dOnlyDelivery = await planner.sendThemeMeetingAgendaEmails(nextPlan, config);
  assert.equal(dOnlyDelivery.failed, 0);
  assert.equal(dOnlyDelivery.sent, 4);
  const observerMessages = sent.filter((mail) => mail.to === 'observer@example.test');
  assert.equal(observerMessages.length, 2);
  assert.match(observerMessages[1]!.text, /Theme D —/);
  assert.doesNotMatch(observerMessages[1]!.text, /Theme C —/);
  assert.match(observerMessages[1]!.html, /Theme D &mdash;/);
  assert.doesNotMatch(observerMessages[1]!.html, /Theme C &mdash;/);
  assert.equal((await planner.sendThemeMeetingAgendaEmails(nextPlan, config)).sent, 0);
  await subscribe('D', false);
  await subscribe('C', false);
  assert.deepEqual(await subscriptions.listThemeAgendaSubscriptions(observer.id), []);
  assert.equal(themeAgendaRecipients(plan, config, await subscriptions.listThemeAgendaSubscriptions()).has('observer'), false);
  await subscriptions.setThemeAgendaSubscription(observer.id, 'C', true);
  await db.pool.query("UPDATE users SET provisioning_status = 'disabled' WHERE id = $1", [observer.id]);
  assert.equal((await subscriptions.listThemeAgendaSubscriptions()).some((row) => row.username === observer.username), false);
  await db.pool.query('DELETE FROM users WHERE id = $1', [observer.id]);
  assert.equal((await db.pool.query('SELECT * FROM theme_agenda_subscriptions WHERE user_id = $1', [observer.id])).rows.length, 0);
  assert.equal(await readFile(process.env.THEME_MEETING_CONFIG_PATH!, 'utf8'), originalConfig, 'Subscriptions never change theme membership/configuration.');
  console.log('Agenda subscriptions passed: automatic member/PI subscriptions, API unsubscribe protection, self-service opt-in/out, persistence, permissions, reminders, C-only and D-only delivery (HTML and plain text), preferences, cancellation and deduplication. No external mail sent.');
} finally {
  nodemailer.createTransport = originalTransport;
  await db?.disconnect();
  if (created) await source.pool.query(`DROP DATABASE "${database}" WITH (FORCE)`);
  await source.disconnect();
  await rm(directory, { recursive: true, force: true });
}
process.exit(0);
