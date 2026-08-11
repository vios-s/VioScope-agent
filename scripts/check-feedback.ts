import 'dotenv/config';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createSessionToken, sessionCookieName } from '../src/mastra/auth/session';
import { createPostgresClient } from '../src/mastra/db/postgres';
import { getUserByUsername, upsertLocalUser, type AuthUser } from '../src/mastra/db/users';

const stamp = Date.now().toString(36);
const usernames = {
  owner: `feedback.owner.${stamp}`,
  intruder: `feedback.intruder.${stamp}`,
  admin: `feedback.admin.${stamp}`,
};
const uploadRoot = join(tmpdir(), 'vioscope-feedback-check', stamp);

process.env.FEEDBACK_UPLOAD_DIR = uploadRoot;
process.env.EMAIL_NOTIFICATIONS_ENABLED = 'false';

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
    assert.equal(adminPayload.queries.length, 1);
    assert.equal(adminPayload.canManage, true);
    console.log(JSON.stringify({ feedbackId: created.query.id, ownerQueries: ownerPayload.queries.length, status: updated.query.status }, null, 2));
  } finally {
    await cleanup();
  }
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  await cleanup();
  process.exitCode = 1;
});
