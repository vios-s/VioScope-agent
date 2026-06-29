import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  defaultUserMemoryMarkdown,
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
await rm(checkDir, { recursive: true, force: true });

console.log('User datastore check passed.');
