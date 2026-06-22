import assert from 'node:assert/strict';
import { canSeeAll, createSessionToken, isUserName, verifySessionToken } from '../src/mastra/auth/session';
import {
  assertMediumPassword,
  assertStrongPassword,
  hashPassword,
  isStrongPassword,
  passwordStrength,
  verifyPassword,
  type AuthUser,
} from '../src/mastra/db/users';

async function main() {
  assert.equal(passwordStrength('123456'), 'weak');
  assert.equal(passwordStrength('Password1'), 'weak');
  assert.equal(passwordStrength('Password1!'), 'medium');
  assert.equal(passwordStrength('VeryStrong1!'), 'strong');
  assert.equal(isStrongPassword('VeryStrong1!'), true);
  assert.equal(isStrongPassword('weak'), false);
  assert.throws(() => assertMediumPassword('123456'), /Password must/);
  assert.throws(() => assertMediumPassword('Password1'), /Password must/);
  assert.doesNotThrow(() => assertMediumPassword('Password1!'));
  assert.throws(() => assertStrongPassword('Password1'), /Password must/);

  const hash = await hashPassword('VeryStrong1!');
  assert.equal(await verifyPassword('VeryStrong1!', hash), true);
  assert.equal(await verifyPassword('Wrong1!', hash), false);
  assert.equal(await verifyPassword('VeryStrong1!', 'not-a-valid-hash'), false);

  const user: AuthUser = {
    id: '00000000-0000-0000-0000-000000000001',
    username: 'alice',
    displayName: 'Alice Example',
    email: 'alice@example.test',
    role: 'administrator' as const,
    provisioningStatus: 'active',
    sourceProfileId: 'alice.md',
    aliases: ['AE'],
    passwordResetRequired: false,
    passwordChangedAt: null,
    lastLoginAt: null,
  };
  const token = createSessionToken(user);
  assert.equal(verifySessionToken(token)?.sub, user.id);
  assert.equal(verifySessionToken(`${token}x`), null);
  assert.equal(canSeeAll(user), true);
  assert.equal(isUserName('Alice Example', user), true);
  assert.equal(isUserName('AE', user), true);
  assert.equal(isUserName('someone else', user), false);

  console.log('User password checks passed.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
