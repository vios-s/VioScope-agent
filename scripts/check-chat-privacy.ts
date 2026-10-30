import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPostgresClient, closePostgresPools } from '../src/mastra/db/postgres';

const original = process.env.DATABASE_URL!;
const source = createPostgresClient();
const database = `chat_privacy_${randomUUID().replaceAll('-', '')}`;
const directory = await mkdtemp(join(tmpdir(), 'chat-privacy-'));
let created = false;
try {
  await source.pool.query(`CREATE DATABASE "${database}"`); created = true;
  const url = new URL(original); url.pathname = '/' + database;
  Object.assign(process.env, { DATABASE_URL: url.toString(), DATASTORE_DIR: directory,
    AUTH_SECRET: randomUUID(), VIOSCOPE_RUNTIME_CONFIG_CACHE_PATH: join(directory, 'runtime.json'),
    THEME_MEETING_CONFIG_PATH: join(directory, 'themes.yaml'), EMAIL_NOTIFICATIONS_ENABLED: 'false',
    MASTRA_STORAGE_URL: `file:${directory}/mastra.db` });
  await writeFile(join(directory, 'themes.yaml'), 'timezone: Europe/London\ncycle:\n  rotation: [AB]\n  anchor_date: 2026-10-28\nthemes: []\n');
  const users = await import('../src/mastra/db/users'); await users.ensureUsersTable();
  for (const name of ['author', 'member', 'outsider']) await createPostgresClient().pool.query(
    `INSERT INTO users(id,username,display_name,email,role,provisioning_status,password_reset_required)
     VALUES($1,$2,$2,$3,'member','active',false)`, [randomUUID(), name, `${name}@example.test`]);
  const owner = (await users.getUserByUsername('author'))!, member = (await users.getUserByUsername('member'))!, outsider = (await users.getUserByUsername('outsider'))!;
  const { writeOwnUserMemory } = await import('../src/mastra/users/datastore');
  await writeOwnUserMemory(owner, 'PRIVATE_OWNER_MARKER');
  await writeOwnUserMemory(member, 'PRIVATE_MEMBER_MARKER');
  const chat = await import('../src/mastra/db/chat');
  const auth = await import('../src/mastra/auth/session');
  const { mastra } = await import('../src/mastra');
  const agent = mastra.getAgent('vioscopeAgent');
  const calls: { input: string; options: any }[] = [];
  let duringGeneration: (() => Promise<void>) | undefined;
  agent.generate = (async (input: any, options: any) => {
    calls.push({ input: String(input), options });
    await duringGeneration?.();
    return { text: 'Synthetic visible answer.', toolCalls: [], toolResults: [], finishReason: 'stop' };
  }) as unknown as typeof agent.generate;
  const route = await import('../app/api/chat/route');
  const post = (user: typeof owner, threadId: string, message = 'Please summarise the VioScope thread so far.') => route.POST(new Request('http://localhost/api/chat', {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: `${auth.sessionCookieName}=${auth.createSessionToken(user)}` },
    body: JSON.stringify({ threadId, message }),
  }));
  assert.equal((await post(owner, 'private')).status, 200);
  assert.match(calls.at(-1)!.input, /PRIVATE_OWNER_MARKER/, 'Private notes remain usable in personal chats.');
  assert.equal(calls.at(-1)!.options.memory, undefined, 'Augmented model history is never reopened or written.');
  assert.equal((await post(owner, 'private', '@member please summarise this VioScope conversation.')).status, 200);
  assert.doesNotMatch(calls.at(-1)!.input, /PRIVATE_.*_MARKER/, 'The first sharing turn excludes private notes.');
  assert.deepEqual(calls.at(-1)!.options.context.map((m: any) => m.role), ['user', 'assistant']);
  for (const actor of [owner, member]) {
    assert.equal((await post(actor, 'private')).status, 200);
    const call = calls.at(-1)!;
    assert.doesNotMatch(call.input + JSON.stringify(call.options.context), /PRIVATE_.*_MARKER/);
    assert.equal(call.options.memory, undefined);
    assert.ok(call.options.context.some((m: any) => m.content === 'Synthetic visible answer.'), 'Shared chat continuity uses visible turns.');
  }
  const count = calls.length;
  assert.equal((await post(outsider, 'private')).status, 404);
  assert.equal(calls.length, count);
  // A concurrent sharing request must not publish the in-flight private-context response.
  assert.equal((await post(owner, 'race')).status, 200);
  const before = (await chat.listChatSessionsForUser(owner.id)).find(s => s.threadId === 'race')!.messages.length;
  duringGeneration = () => chat.shareChatSessionWithMentions({ sessionId: 'race', actor: owner, message: '@member' }).then(() => undefined);
  assert.equal((await post(owner, 'race')).status, 409);
  assert.equal((await chat.listChatSessionsForUser(owner.id)).find(s => s.threadId === 'race')!.messages.length, before);
  console.log('Chat privacy passed: personal notes, first sharing turn, both shared identities, visible history, outsider denial and concurrent sharing. Simulated model only.');
} finally {
  await closePostgresPools(); process.env.DATABASE_URL = original;
  if (created) { await createPostgresClient().pool.query(`DROP DATABASE "${database}" WITH (FORCE)`); await closePostgresPools(); }
  await rm(directory, { recursive: true, force: true });
}
