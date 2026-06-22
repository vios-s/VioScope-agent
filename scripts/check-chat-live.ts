import 'dotenv/config';
import assert from 'node:assert/strict';
import { createSessionToken, sessionCookieName } from '../src/mastra/auth/session';
import { createPostgresClient } from '../src/mastra/db/postgres';
import { getUserByUsername, upsertLocalUser, type AuthUser } from '../src/mastra/db/users';

const username = `chat.live.member.${Date.now()}`;
const sessionId = `chat-live-smoke-${Date.now()}`;

function email(value: string): string {
  return `${value}@example.test`;
}

async function seedUser(): Promise<AuthUser> {
  await upsertLocalUser({
    username,
    email: email(username),
    password: 'ChatLive1!',
    role: 'member',
    displayName: username,
    source: 'chat_live_check',
  });
  const user = await getUserByUsername(username);
  assert.ok(user, 'Expected live chat smoke user to exist.');
  return user;
}

async function cleanup(): Promise<void> {
  const postgres = createPostgresClient('chat-live-cleanup');

  try {
    await postgres.pool.query('DELETE FROM chat_sessions WHERE id = $1', [sessionId]).catch(() => undefined);
    await postgres.pool.query('DELETE FROM audit_log WHERE actor_username = $1', [username]).catch(() => undefined);
    await postgres.pool.query('DELETE FROM users WHERE username = $1', [username]).catch(() => undefined);
  } finally {
    await postgres.disconnect();
  }
}

async function chatAuditMetadata(): Promise<Record<string, unknown> | null> {
  const postgres = createPostgresClient('chat-live-audit');

  try {
    const result = await postgres.pool.query<{ metadata: Record<string, unknown> }>(
      `
        SELECT metadata
        FROM audit_log
        WHERE actor_username = $1
          AND action = 'chat.turn'
          AND target_id = $2
        ORDER BY event_time DESC
        LIMIT 1
      `,
      [username, sessionId],
    );
    return result.rows[0]?.metadata ?? null;
  } finally {
    await postgres.disconnect();
  }
}

async function main() {
  const user = await seedUser();

  try {
    const response = await fetch('http://localhost:3000/api/chat', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: `${sessionCookieName}=${createSessionToken(user)}`,
      },
      body: JSON.stringify({
        threadId: sessionId,
        message: 'Using the VioScope wiki, briefly summarize what theme meetings are for.',
      }),
    });
    const body = (await response.json()) as {
      text?: string;
      finishReason?: string;
      sources?: unknown[];
      error?: string;
    };
    assert.equal(response.status, 200, body.error || 'Live chat should return 200.');
    assert.ok(body.text?.trim(), 'Live chat should return assistant text.');
    assert.notEqual(body.finishReason, 'scope_refusal', 'Live chat should not be out-of-scope refused.');

    const metadata = await chatAuditMetadata();
    assert.ok(metadata, 'Live chat should write chat.turn audit metadata.');
    assert.equal(typeof metadata.messageLength, 'number', 'Audit metadata should record message length.');
    assert.equal(metadata.prompt, undefined, 'Audit metadata should not store full prompt.');
    assert.equal(metadata.response, undefined, 'Audit metadata should not store full response.');

    console.log('Live chat check passed.');
    console.log(JSON.stringify({ finishReason: body.finishReason, sourceCount: body.sources?.length ?? 0 }, null, 2));
  } finally {
    await cleanup();
  }
}

main().catch(async (error) => {
  await cleanup().catch(() => undefined);
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
