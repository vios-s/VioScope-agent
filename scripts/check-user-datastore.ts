import assert from 'node:assert/strict';
import { userDatastoreRoot, userDatastoreSlug } from '../src/mastra/users/datastore';

process.env.DATASTORE_DIR = '/Public/';

const primary = { username: 'alice.example', sourceProfileId: 'alice.md' };
const fallback = { username: 'bob.example', sourceProfileId: null };

assert.equal(userDatastoreSlug(primary), 'alice');
assert.equal(userDatastoreRoot(primary), '/Public/users/alice');
assert.equal(userDatastoreSlug(fallback), 'bob.example');
assert.equal(userDatastoreRoot(fallback), '/Public/users/bob.example');

console.log('User datastore check passed.');
