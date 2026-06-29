import 'dotenv/config';
import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createSessionToken, sessionCookieName } from '../src/mastra/auth/session';
import { createPostgresClient } from '../src/mastra/db/postgres';
import { getUserByUsername, upsertLocalUser, type AuthUser, type UserRole } from '../src/mastra/db/users';
import { runtimeEnv } from '../src/mastra/runtime-config';
import { userDatastoreRoot } from '../src/mastra/users/datastore';

const stamp = Date.now();
const aliceName = `m3.alice.${stamp}`;
const bobName = `m3.bob.${stamp}`;
const aliceCode = `M3ALICE${stamp}`;
const bobCode = `M3BOB${stamp}`;
const sessionCode = `M3SESSION${stamp}`;
const sessionThread = `m3-session-${stamp}`;
const shareThread = `m3-share-${stamp}`;
const memoryThreadAlice = `m3-memory-alice-${stamp}`;
const memoryThreadBob = `m3-memory-bob-${stamp}`;
const threadIds = [sessionThread, shareThread, memoryThreadAlice, memoryThreadBob];

function includesCode(text: string | undefined, code: string): boolean {
  return (text || '').toUpperCase().replace(/[^A-Z0-9]/g, '').includes(code);
}

function email(username: string): string {
  return `${username}@example.test`;
}

async function seedUser(username: string, role: UserRole = 'member'): Promise<AuthUser> {
  await upsertLocalUser({
    username,
    email: email(username),
    password: 'MemoryCheck1!',
    role,
    displayName: username,
    source: 'memory_check',
  });
  const user = await getUserByUsername(username);
  assert.ok(user, `Expected ${username} to exist.`);
  return user;
}

async function writePrivateMemory(user: AuthUser, code: string): Promise<string> {
  const root = userDatastoreRoot(user);
  assert.ok(root, 'DATASTORE_DIR must be configured for user datastore memory.');
  await mkdir(root, { recursive: true });
  await writeFile(
    join(root, 'memory.md'),
    `# Private VioScope User Memory\n\n- Private memory code: ${code}\n- This code belongs only to ${user.username}.\n`,
    'utf8',
  );
  return root;
}

async function chat(user: AuthUser, threadId: string, message: string): Promise<string> {
  const response = await fetch('http://localhost:3000/api/chat', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: `${sessionCookieName}=${createSessionToken(user)}`,
    },
    body: JSON.stringify({ threadId, message }),
  });
  const body = (await response.json()) as { text?: string; error?: string };
  assert.equal(response.status, 200, body.error || `Chat failed for ${user.username}.`);
  const answer = body.text?.trim();
  assert.ok(answer, `Expected chat text for ${user.username}.`);
  return answer;
}

async function cleanup(users: AuthUser[], roots: string[]) {
  const postgres = createPostgresClient('memory-check-cleanup');

  try {
    await postgres.pool.query('DELETE FROM chat_sessions WHERE id = ANY($1::text[])', [threadIds]).catch(() => undefined);
    await postgres.pool
      .query('DELETE FROM audit_log WHERE actor_username = ANY($1::text[])', [users.map((user) => user.username)])
      .catch(() => undefined);
    await postgres.pool.query('DELETE FROM users WHERE username = ANY($1::text[])', [users.map((user) => user.username)]).catch(() => undefined);
  } finally {
    await postgres.disconnect();
  }

  for (const root of roots) {
    await rm(root, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function main() {
  const datastoreDir = runtimeEnv('DATASTORE_DIR').trim();
  assert.ok(datastoreDir, 'DATASTORE_DIR is required for memory checks.');
  const resolvedDatastore = resolve(process.cwd(), datastoreDir);
  console.log(`Using DATASTORE_DIR=${resolvedDatastore}`);

  const alice = await seedUser(aliceName);
  const bob = await seedUser(bobName);
  const roots: string[] = [];

  try {
    roots.push(await writePrivateMemory(alice, aliceCode));
    roots.push(await writePrivateMemory(bob, bobCode));

    await chat(
      alice,
      sessionThread,
      `For this VioScope session memory test, remember the session code ${sessionCode}. Reply only OK.`,
    );
    const sessionRecall = await chat(
      alice,
      sessionThread,
      'What is the session code I asked you to remember in this same thread? Answer with the code only.',
    );
    assert.ok(includesCode(sessionRecall, sessionCode), `Session memory did not recall ${sessionCode}: ${sessionRecall}`);

    const aliceMemory = await chat(
      alice,
      memoryThreadAlice,
      'Using only my VioScope signed-in user datastore memory, what is my private memory code? Answer with the code only.',
    );
    assert.ok(includesCode(aliceMemory, aliceCode), `Alice memory did not include ${aliceCode}: ${aliceMemory}`);
    assert.equal(includesCode(aliceMemory, bobCode), false, `Alice response leaked Bob code: ${aliceMemory}`);

    const bobMemory = await chat(
      bob,
      memoryThreadBob,
      'Using only my VioScope signed-in user datastore memory, what is my private memory code? Answer with the code only.',
    );
    assert.ok(includesCode(bobMemory, bobCode), `Bob memory did not include ${bobCode}: ${bobMemory}`);
    assert.equal(includesCode(bobMemory, aliceCode), false, `Bob response leaked Alice code: ${bobMemory}`);

    await chat(
      alice,
      shareThread,
      `This is a VioScope chat collaboration boundary test for @${bob.username}. Do not state any private memory code.`,
    );
    const bobShared = await chat(
      bob,
      shareThread,
      `In this shared VioScope session, do you have direct access to ${alice.username}'s private memory code? If not, say NO_PRIVATE_MEMORY.`,
    );
    assert.equal(includesCode(bobShared, aliceCode), false, `Shared chat leaked Alice private memory: ${bobShared}`);

    console.log('Memory check passed.');
    console.log(
      JSON.stringify(
        {
          sessionMemory: 'passed',
          personalMemoryIsolation: 'passed',
          sharedChatDirectMemoryLeak: 'not observed',
        },
        null,
        2,
      ),
    );
  } finally {
    await cleanup([alice, bob], roots);
  }
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
