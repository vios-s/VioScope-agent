import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  defaultUserMemoryMarkdown,
  loadUserDatastoreContext,
  readOwnUserMemory,
  userDatastoreRoot,
  userDatastoreSlug,
  writeOwnUserMemory,
} from '../src/mastra/users/datastore';

process.env.DATASTORE_DIR = '/Public/';

const primary = { username: 'alice.example', sourceProfileId: 'alice.md' };
const fallback = { username: 'bob.example', sourceProfileId: null };

assert.equal(userDatastoreSlug(primary), 'alice');
assert.equal(userDatastoreRoot(primary), '/Public/users/alice');
assert.equal(userDatastoreSlug(fallback), 'bob.example');
assert.equal(userDatastoreRoot(fallback), '/Public/users/bob.example');

const checkDir = resolve('.local/checks/user-datastore');
const user = {
  id: 'check-user',
  username: 'check.user',
  displayName: 'Check User',
  email: 'check@example.test',
  role: 'member',
  position: 'student',
  provisioningStatus: 'active',
  sourceProfileId: 'check.md',
  aliases: [],
  notificationPreferences: {},
  profile: {
    publicRole: 'Researcher',
    publicGroup: 'Checks',
    researchInterests: ['memory checks'],
    publicInfo: [],
  },
  passwordResetRequired: false,
  passwordChangedAt: null,
  lastLoginAt: null,
} as any;

process.env.DATASTORE_DIR = checkDir;
await rm(checkDir, { recursive: true, force: true });
assert.match(defaultUserMemoryMarkdown(user), /Check User memory/);
assert.match((await readOwnUserMemory(user)).markdown, /Check User memory/);
await writeOwnUserMemory(user, '# Private memory\n\nOnly this user can edit it.');
assert.equal((await readOwnUserMemory(user)).markdown, '# Private memory\n\nOnly this user can edit it.');
const longMemory = 'Long private note. '.repeat(500) + 'TAIL_MARKER';
await writeOwnUserMemory(user, longMemory);
const reopened = await readOwnUserMemory(user);
assert.equal(reopened.markdown, longMemory, 'Editor must read the complete saved note.');
await writeOwnUserMemory(user, reopened.markdown);
assert.equal((await readOwnUserMemory(user)).markdown, longMemory);
const context = await loadUserDatastoreContext(user);
assert.ok(context?.memory?.text.endsWith('[truncated]'));
assert.ok(!context?.memory?.text.includes('TAIL_MARKER'), 'Only model context is bounded.');
await rm(checkDir, { recursive: true, force: true });

console.log('User datastore check passed.');
