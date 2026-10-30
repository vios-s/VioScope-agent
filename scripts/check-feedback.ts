import 'dotenv/config';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createSessionToken, sessionCookieName } from '../src/mastra/auth/session';
import { createPostgresClient } from '../src/mastra/db/postgres';
import { defaultNotificationPreferences, getUserByUsername, updateOwnUserProfile, upsertLocalUser, type AuthUser } from '../src/mastra/db/users';
import { listChatNotificationsForUser } from '../src/mastra/db/chat';

const stamp = Date.now().toString(36);
const usernames = {
  owner: `feedback.owner.${stamp}`,
  intruder: `feedback.intruder.${stamp}`,
  admin: `feedback.admin.${stamp}`,
};
const uploadRoot = join(tmpdir(), 'vioscope-feedback-check', stamp);

process.env.FEEDBACK_UPLOAD_DIR = uploadRoot;
process.env.EMAIL_NOTIFICATIONS_ENABLED = 'false';
// Requester emails are asserted only against a local mailpit (never a real SMTP server).
const mailpit = 'http://127.0.0.1:8025';
let mailpitAvailable = false;
async function requesterEmails(to: string): Promise<number> {
  if (!mailpitAvailable) return 0;
  const body = await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:${to} subject:"[VioScope feedback]"`)}`).then((response) => response.json()) as { messages_count?: number };
  return body.messages_count || 0;
}
async function feedbackNotifications(user: AuthUser, feedbackId: string) {
  return (await listChatNotificationsForUser(user.id)).filter((notification) => notification.feedbackId === feedbackId);
}

function requestFor(user: AuthUser, path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set('cookie', `${sessionCookieName}=${createSessionToken(user)}`);
  return new Request(`http://localhost${path}`, { ...init, headers });
}

async function seedUser(username: string, role: 'member' | 'administrator'): Promise<AuthUser> {
  await upsertLocalUser({
    username,
    displayName: username,
    email: `${username}@example.test`,
    password: 'FeedbackCheck1!',
    role,
    passwordResetRequired: false,
    source: 'feedback_check',
  });
  const user = await getUserByUsername(username);
  assert.ok(user, `Expected ${username} to exist.`);
  return user;
}

async function cleanup() {
  const postgres = createPostgresClient('vioscope-feedback-check-cleanup');
  try {
    await postgres.pool.query('DELETE FROM audit_log WHERE actor_username = ANY($1::text[])', [Object.values(usernames)]).catch(() => undefined);
    await postgres.pool.query('DELETE FROM users WHERE username = ANY($1::text[])', [Object.values(usernames)]).catch(() => undefined);
  } finally {
    await postgres.disconnect();
  }
  await rm(uploadRoot, { recursive: true, force: true });
}

async function main() {
  mailpitAvailable = await fetch(`${mailpit}/api/v1/info`).then((response) => response.ok, () => false);
  if (mailpitAvailable) Object.assign(process.env, { EMAIL_NOTIFICATIONS_ENABLED: 'true', SMTP_HOST: '127.0.0.1', SMTP_PORT: '1025', SMTP_USER: '', SMTP_SECURE: 'false', SMTP_IGNORE_TLS: 'true', FEEDBACK_ADMIN_EMAILS: '' });
  await cleanup();
  const feedbackRoute = await import('../app/api/feedback/route');
  const feedbackItemRoute = await import('../app/api/feedback/[feedbackId]/route');
  const attachmentRoute = await import('../app/api/feedback/[feedbackId]/attachment/route');
  const owner = await seedUser(usernames.owner, 'member');
  const intruder = await seedUser(usernames.intruder, 'member');
  const admin = await seedUser(usernames.admin, 'administrator');

  try {
    const form = new FormData();
    form.set('title', 'Screenshot upload fails');
    form.set('description', 'A detailed report with an image attachment.');
    form.set('attachment', new File([new Uint8Array([137, 80, 78, 71])], 'screen shot.png', { type: 'image/png' }));
    const createdResponse = await feedbackRoute.POST(requestFor(owner, '/api/feedback', { method: 'POST', body: form }));
    const created = await createdResponse.json();
    assert.equal(createdResponse.status, 200, created.error || 'Feedback submission failed.');
    assert.equal(created.query.status, 'pending');
    assert.equal(created.query.attachment.name, 'screen-shot.png');

    const ownerList = await feedbackRoute.GET(requestFor(owner, '/api/feedback'));
    const ownerPayload = await ownerList.json();
    assert.equal(ownerPayload.queries.length, 1);
    assert.equal(ownerPayload.canManage, false);

    const intruderList = await feedbackRoute.GET(requestFor(intruder, '/api/feedback'));
    const intruderPayload = await intruderList.json();
    assert.equal(intruderPayload.queries.length, 0);

    const attachmentResponse = await attachmentRoute.GET(
      requestFor(owner, `/api/feedback/${created.query.id}/attachment`),
      { params: Promise.resolve({ feedbackId: created.query.id }) },
    );
    assert.equal(attachmentResponse.status, 200);
    assert.equal((await attachmentResponse.arrayBuffer()).byteLength, 4);

    const forbiddenUpdate = await feedbackItemRoute.PATCH(
      requestFor(owner, `/api/feedback/${created.query.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'solved', adminNote: 'forged' }),
      }),
      { params: Promise.resolve({ feedbackId: created.query.id }) },
    );
    assert.equal(forbiddenUpdate.status, 403);

    const updateResponse = await feedbackItemRoute.PATCH(
      requestFor(admin, `/api/feedback/${created.query.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'solved', adminNote: 'Fixed in the next release.' }),
      }),
      { params: Promise.resolve({ feedbackId: created.query.id }) },
    );
    const updated = await updateResponse.json();
    assert.equal(updateResponse.status, 200, updated.error || 'Admin update failed.');
    assert.equal(updated.query.status, 'solved');
    assert.equal(updated.query.adminNote, 'Fixed in the next release.');
    assert.equal(updated.query.resolvedByUsername, admin.username);

    const adminList = await feedbackRoute.GET(requestFor(admin, '/api/feedback'));
    const adminPayload = await adminList.json();
    // The shared check database may hold other requests: scope to the one created here.
    assert.ok(adminPayload.queries.some((query: { id: string }) => query.id === created.query.id));
    assert.equal(adminPayload.canManage, true);

    // Requester notification: one web notification (bell → Feedback) and one email per real change.
    const feedbackId = created.query.id as string;
    const patch = (actor: AuthUser, id: string, body: Record<string, unknown>) => feedbackItemRoute.PATCH(
      requestFor(actor, `/api/feedback/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
      { params: Promise.resolve({ feedbackId: id }) },
    ).then((response) => response.json());
    let notices = await feedbackNotifications(owner, feedbackId);
    assert.equal(notices.length, 1, 'The requester receives one web notification for the reply.');
    assert.equal(notices[0].type, 'feedback_reply');
    assert.equal(notices[0].sessionId, null);
    assert.match(notices[0].body, /Fixed in the next release/);
    assert.equal((await feedbackNotifications(admin, feedbackId)).length, 0, 'The administrator is not notified about their own change.');
    assert.deepEqual(updated.requesterNotified, { web: true, email: mailpitAvailable });
    const resaved = await patch(admin, feedbackId, { status: 'solved', adminNote: 'Fixed in the next release.' });
    assert.deepEqual(resaved.requesterNotified, { web: false, email: false }, 'Saving the same reply twice does not notify twice.');
    assert.equal((await feedbackNotifications(owner, feedbackId)).length, 1);
    await patch(admin, feedbackId, { status: 'closed', adminNote: 'Fixed in the next release.' });
    notices = await feedbackNotifications(owner, feedbackId);
    assert.equal(notices.length, 2, 'A status change alone notifies the requester.');
    assert.match(notices[0].title, /is now Closed/);
    // Web off, email on: the email channel still follows the preference.
    await updateOwnUserProfile({ userId: owner.id, notificationPreferences: { ...defaultNotificationPreferences(), feedback_replies: { web: false, email: true } } });
    const emailOnly = await patch(admin, feedbackId, { status: 'closed', adminNote: 'Released in version 2.' });
    assert.deepEqual(emailOnly.requesterNotified, { web: false, email: mailpitAvailable });
    assert.equal((await feedbackNotifications(owner, feedbackId)).length, 2);
    if (mailpitAvailable) assert.equal(await requesterEmails(owner.email!), 3, 'One requester email per real change.');
    // An administrator's own request and inactive requesters are never notified.
    const ownForm = new FormData();
    ownForm.set('title', 'Administrator note to self');
    ownForm.set('description', 'Synthetic request from the administrator.');
    const own = await (await feedbackRoute.POST(requestFor(admin, '/api/feedback', { method: 'POST', body: ownForm }))).json();
    assert.deepEqual((await patch(admin, own.query.id, { status: 'solved', adminNote: 'Done.' })).requesterNotified, { web: false, email: false });
    assert.equal((await feedbackNotifications(admin, own.query.id)).length, 0);
    const postgres = createPostgresClient('vioscope-feedback-check-disable');
    try {
      await postgres.pool.query("UPDATE users SET provisioning_status = 'disabled' WHERE id = $1", [owner.id]);
    } finally {
      await postgres.disconnect();
    }
    assert.deepEqual((await patch(admin, feedbackId, { status: 'in_progress', adminNote: 'Reopened.' })).requesterNotified, { web: false, email: false });
    console.log(JSON.stringify({ feedbackId, ownerQueries: ownerPayload.queries.length, status: updated.query.status, requesterNotifications: notices.length, mailpitAvailable }, null, 2));
  } finally {
    await cleanup();
  }
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  await cleanup();
  process.exitCode = 1;
});
