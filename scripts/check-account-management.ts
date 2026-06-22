import 'dotenv/config';
import assert from 'node:assert/strict';
import { createSessionToken, sessionCookieName } from '../src/mastra/auth/session';
import { createPostgresClient } from '../src/mastra/db/postgres';
import {
  ensureUsersTable,
  getUserByUsername,
  upsertLocalUser,
  type AuthUser,
  type UserRole,
} from '../src/mastra/db/users';

type SnapshotRow = {
  id: string;
  username: string;
  display_name: string;
  email: string;
  role: string;
  password_hash: string | null;
  password_reset_required: boolean;
  password_changed_at: string | null;
  last_login_at: string | null;
  auth_provider: string;
  provisioning_status: string;
  source: string;
  source_url: string | null;
  source_profile_id: string | null;
  metadata: string;
  created_at: string;
  updated_at: string;
};

type UserSnapshot = {
  username: string;
  row: SnapshotRow | null;
};

const users = {
  admin: { username: 'account.smoke.admin', role: 'administrator' as const, password: 'AdminPass1!' },
  pi: { username: 'account.smoke.pi', role: 'pi' as const, password: 'PiPass123!' },
  member: { username: 'account.smoke.member', role: 'member' as const, password: 'Member123!' },
  reset: { username: 'account.smoke.reset', role: 'member' as const, password: '123456' },
  disabled: { username: 'account.smoke.disabled', role: 'member' as const, password: 'Disabled123!' },
  profileOnly: { username: 'account.smoke.profile', role: 'viewer' as const },
  piBlockedAdmin: { username: 'account.smoke.pi.blocked.admin', role: 'administrator' as const },
  noEmailInvite: { username: 'account.smoke.no.email', role: 'member' as const },
};

function email(username: string): string {
  return `${username}@example.test`;
}

async function snapshotUsers(usernames: string[]): Promise<Map<string, UserSnapshot>> {
  await ensureUsersTable();
  const postgres = createPostgresClient('account-management-snapshot');

  try {
    const result = await postgres.pool.query<SnapshotRow>(
      `
        SELECT
          id::text,
          username,
          display_name,
          email,
          role,
          password_hash,
          password_reset_required,
          password_changed_at::text,
          last_login_at::text,
          auth_provider,
          provisioning_status,
          source,
          source_url,
          source_profile_id,
          metadata::text,
          created_at::text,
          updated_at::text
        FROM users
        WHERE username = ANY($1::text[])
      `,
      [usernames],
    );
    const rows = new Map<string, SnapshotRow>(result.rows.map((row: SnapshotRow) => [row.username, row]));
    return new Map(usernames.map((username): [string, UserSnapshot] => [username, { username, row: rows.get(username) || null }]));
  } finally {
    await postgres.disconnect();
  }
}

async function restoreUsers(snapshots: Map<string, UserSnapshot>): Promise<void> {
  await ensureUsersTable();
  const postgres = createPostgresClient('account-management-restore');

  try {
    for (const snapshot of snapshots.values()) {
      if (!snapshot.row) {
        await postgres.pool.query('DELETE FROM users WHERE username = $1', [snapshot.username]);
        continue;
      }

      const row = snapshot.row;
      await postgres.pool.query(
        `
          UPDATE users
          SET
            username = $2,
            display_name = $3,
            email = $4,
            role = $5,
            password_hash = $6,
            password_reset_required = $7,
            password_changed_at = $8::timestamptz,
            last_login_at = $9::timestamptz,
            auth_provider = $10,
            provisioning_status = $11,
            source = $12,
            source_url = $13,
            source_profile_id = $14,
            metadata = $15::jsonb,
            created_at = $16::timestamptz,
            updated_at = $17::timestamptz
          WHERE id = $1
        `,
        [
          row.id,
          row.username,
          row.display_name,
          row.email,
          row.role,
          row.password_hash,
          row.password_reset_required,
          row.password_changed_at,
          row.last_login_at,
          row.auth_provider,
          row.provisioning_status,
          row.source,
          row.source_url,
          row.source_profile_id,
          row.metadata,
          row.created_at,
          row.updated_at,
        ],
      );
    }
  } finally {
    await postgres.disconnect();
  }
}

async function seedUser(input: {
  username: string;
  role: UserRole;
  password: string;
  passwordResetRequired?: boolean;
}): Promise<AuthUser> {
  await upsertLocalUser({
    username: input.username,
    email: email(input.username),
    password: input.password,
    role: input.role,
    displayName: input.username,
    passwordResetRequired: input.passwordResetRequired,
    source: 'account_management_check',
  });
  const user = await getUserByUsername(input.username);
  assert.ok(user, `Expected ${input.username} to exist.`);
  return user;
}

async function seedProfileOnly(): Promise<void> {
  const postgres = createPostgresClient('account-management-profile-only');

  try {
    await postgres.pool.query(
      `
        INSERT INTO users (
          username,
          display_name,
          email,
          role,
          password_hash,
          auth_provider,
          provisioning_status,
          source,
          metadata
        )
        VALUES ($1, $2, '', 'viewer', NULL, 'local', 'profile_only', 'account_management_check', '{}'::jsonb)
        ON CONFLICT (username) DO UPDATE
        SET
          display_name = EXCLUDED.display_name,
          email = '',
          role = 'viewer',
          password_hash = NULL,
          provisioning_status = 'profile_only',
          source = EXCLUDED.source,
          updated_at = now()
      `,
      [users.profileOnly.username, users.profileOnly.username],
    );
  } finally {
    await postgres.disconnect();
  }
}

async function setStatus(username: string, status: 'active' | 'disabled'): Promise<void> {
  const postgres = createPostgresClient('account-management-status');

  try {
    await postgres.pool.query('UPDATE users SET provisioning_status = $2, updated_at = now() WHERE username = $1', [
      username,
      status,
    ]);
  } finally {
    await postgres.disconnect();
  }
}

async function cleanupAuditLogs(usernames: string[]): Promise<void> {
  const postgres = createPostgresClient('account-management-audit-cleanup');

  try {
    await postgres.pool.query(
      `
        DELETE FROM audit_log
        WHERE actor_username = ANY($1::text[])
          OR target_id = ANY($1::text[])
          OR target_id LIKE 'account.smoke.%'
          OR metadata::text LIKE '%account.smoke.%'
      `,
      [usernames],
    );
  } catch {
    // audit_log may not exist if the check failed before audit setup.
  } finally {
    await postgres.disconnect();
  }
}

function jsonRequest(path: string, body: unknown, cookie?: string): Request {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (cookie) headers.set('cookie', cookie);
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

function getRequest(path: string, cookie?: string): Request {
  const headers = new Headers();
  if (cookie) headers.set('cookie', cookie);
  return new Request(`http://localhost${path}`, { headers });
}

function cookieFor(user: AuthUser): string {
  return `${sessionCookieName}=${createSessionToken(user)}`;
}

async function jsonBody(response: Response): Promise<any> {
  return response.json();
}

async function login(username: string, password: string): Promise<{ response: Response; body: any; cookie: string | null }> {
  const loginRoute = await import('../app/api/auth/login/route');
  const response = await loginRoute.POST(jsonRequest('/api/auth/login', { username, password }));
  return { response, body: await jsonBody(response), cookie: response.headers.get('set-cookie') };
}

async function main() {
  const usernames = Object.values(users).map((user) => user.username);
  const snapshots = await snapshotUsers(usernames);

  try {
    const admin = await seedUser(users.admin);
    const pi = await seedUser(users.pi);
    await seedUser(users.member);
    const resetUser = await seedUser({ ...users.reset, passwordResetRequired: true });
    await seedUser(users.disabled);
    await setStatus(users.disabled.username, 'disabled');
    await seedProfileOnly();

    const loginRoute = await import('../app/api/auth/login/route');
    const meRoute = await import('../app/api/auth/me/route');
    const changePasswordRoute = await import('../app/api/auth/change-password/route');
    const logoutRoute = await import('../app/api/auth/logout/route');
    const usersRoute = await import('../app/api/users/route');
    const userRoute = await import('../app/api/users/[userId]/route');
    const accountRoute = await import('../app/api/account/route');
    const auditRoute = await import('../app/api/audit-log/route');
    const labStateRoute = await import('../app/api/lab-state/route');

    const badLogin = await loginRoute.POST(jsonRequest('/api/auth/login', {
      username: users.member.username,
      password: 'Wrong123!',
    }));
    assert.equal(badLogin.status, 401, 'Wrong password should fail.');
    assert.equal((await jsonBody(badLogin)).error, 'Invalid username or password.');

    const disabledLogin = await login(users.disabled.username, users.disabled.password);
    assert.equal(disabledLogin.response.status, 401, 'Disabled user should not log in.');

    const profileLogin = await login(users.profileOnly.username, 'anything');
    assert.equal(profileLogin.response.status, 401, 'Profile-only user should not log in.');

    const resetLogin = await login(users.reset.username, users.reset.password);
    assert.equal(resetLogin.response.status, 200, 'Temporary password should log in before forced reset.');
    assert.equal(resetLogin.body.user.passwordResetRequired, true);
    assert.ok(resetLogin.cookie?.includes(`${sessionCookieName}=`), 'Login should set session cookie.');
    assert.ok(resetLogin.cookie?.toLowerCase().includes('httponly'), 'Session cookie should be httpOnly.');
    assert.ok(resetLogin.cookie?.toLowerCase().includes('samesite=lax'), 'Session cookie should use SameSite=Lax.');

    const me = await meRoute.GET(getRequest('/api/auth/me', resetLogin.cookie || undefined));
    assert.equal(me.status, 200, 'Password-reset user may read /me.');

    const blockedByReset = await labStateRoute.GET(getRequest('/api/lab-state', resetLogin.cookie || undefined));
    assert.equal(blockedByReset.status, 403, 'Password-reset user should be blocked from normal app APIs.');

    const weakChange = await changePasswordRoute.POST(jsonRequest('/api/auth/change-password', {
      currentPassword: users.reset.password,
      newPassword: 'Password1',
    }, resetLogin.cookie || undefined));
    assert.equal(weakChange.status, 400, 'Password without special character should be rejected.');

    const goodChange = await changePasswordRoute.POST(jsonRequest('/api/auth/change-password', {
      currentPassword: users.reset.password,
      newPassword: 'Password1!',
    }, resetLogin.cookie || undefined));
    assert.equal(goodChange.status, 200, 'Medium password should be accepted.');
    assert.equal((await jsonBody(goodChange)).user.passwordResetRequired, false);

    const logout = await logoutRoute.POST(jsonRequest('/api/auth/logout', {}, resetLogin.cookie || undefined));
    assert.equal(logout.status, 200, 'Logout should succeed.');
    const logoutCookie = logout.headers.get('set-cookie') || '';
    assert.ok(logoutCookie.includes(`${sessionCookieName}=`), 'Logout should clear session cookie.');
    assert.ok(logoutCookie.toLowerCase().includes('max-age=0'), 'Logout cookie should expire immediately.');

    const adminList = await usersRoute.GET(getRequest('/api/users', cookieFor(admin)));
    assert.equal(adminList.status, 200, 'Admin should list users.');

    const member = await getUserByUsername(users.member.username);
    assert.ok(member);
    const memberList = await usersRoute.GET(getRequest('/api/users', cookieFor(member)));
    assert.equal(memberList.status, 403, 'Member should not list users.');

    const noEmailCreate = await usersRoute.POST(jsonRequest('/api/users', {
      username: users.noEmailInvite.username,
      role: users.noEmailInvite.role,
    }, cookieFor(admin)));
    assert.equal(noEmailCreate.status, 200, 'Admin should create first-login account without email.');
    const noEmailLogin = await login(users.noEmailInvite.username, users.noEmailInvite.username);
    assert.equal(noEmailLogin.response.status, 200, 'Username temporary password should log in.');
    assert.equal(noEmailLogin.body.user.email, null);
    assert.equal(noEmailLogin.body.user.passwordResetRequired, true);
    const noEmailBlockedChange = await changePasswordRoute.POST(jsonRequest('/api/auth/change-password', {
      currentPassword: users.noEmailInvite.username,
      newPassword: 'NoEmail1!',
    }, noEmailLogin.cookie || undefined));
    assert.equal(noEmailBlockedChange.status, 400, 'First-login password change should require email when missing.');
    const noEmailGoodChange = await changePasswordRoute.POST(jsonRequest('/api/auth/change-password', {
      currentPassword: users.noEmailInvite.username,
      email: email(users.noEmailInvite.username),
      newPassword: 'NoEmail1!',
    }, noEmailLogin.cookie || undefined));
    assert.equal(noEmailGoodChange.status, 200, 'First-login email and password should be accepted.');
    const noEmailChangedUser = (await jsonBody(noEmailGoodChange)).user;
    assert.equal(noEmailChangedUser.email, email(users.noEmailInvite.username));
    assert.equal(noEmailChangedUser.passwordResetRequired, false);

    const piCreatesAdmin = await usersRoute.POST(jsonRequest('/api/users', {
      username: users.piBlockedAdmin.username,
      email: email(users.piBlockedAdmin.username),
      temporaryPassword: '123456',
      role: 'administrator',
    }, cookieFor(pi)));
    assert.equal(piCreatesAdmin.status, 400, 'PI should not create admin accounts.');

    const adminDisablesSelf = await userRoute.PATCH(
      jsonRequest(`/api/users/${admin.id}`, { provisioningStatus: 'disabled' }, cookieFor(admin)),
      { params: Promise.resolve({ userId: admin.id }) },
    );
    assert.equal(adminDisablesSelf.status, 400, 'Admin should not disable self.');

    const adminRemovesOwnRole = await userRoute.PATCH(
      jsonRequest(`/api/users/${admin.id}`, { role: 'member' }, cookieFor(admin)),
      { params: Promise.resolve({ userId: admin.id }) },
    );
    assert.equal(adminRemovesOwnRole.status, 400, 'Admin should not remove own administrator role.');

    const badEmail = await accountRoute.PATCH(jsonRequest('/api/account', { email: 'not-an-email' }, cookieFor(member)));
    assert.equal(badEmail.status, 400, 'Invalid account email should be rejected.');

    const nextEmail = 'account.smoke.member.next@example.test';
    const goodEmail = await accountRoute.PATCH(jsonRequest('/api/account', { email: nextEmail }, cookieFor(member)));
    assert.equal(goodEmail.status, 200, 'Valid account email should be accepted.');
    assert.equal((await jsonBody(goodEmail)).user.email, nextEmail);

    const memberAudit = await auditRoute.GET(getRequest('/api/audit-log', cookieFor(member)));
    assert.equal(memberAudit.status, 403, 'Members should not read audit logs.');

    const auditDay = new Date().toISOString().slice(0, 10);
    const adminAudit = await auditRoute.GET(getRequest(`/api/audit-log?day=${auditDay}`, cookieFor(admin)));
    assert.equal(adminAudit.status, 200, 'Administrators should read audit logs.');
    const auditBody = await jsonBody(adminAudit);
    assert.equal(auditBody.fileName, `audit-${auditDay}.jsonl`);
    assert.ok(
      (auditBody.days || []).some((logDay: { day: string; fileName: string }) => (
        logDay.day === auditDay && logDay.fileName === `audit-${auditDay}.jsonl`
      )),
      'Audit log should list available daily log files.',
    );
    const auditActions = new Set((auditBody.logs || []).map((log: { action: string }) => log.action));
    assert.ok(auditActions.has('auth.login_failure'), 'Audit log should include failed login.');
    assert.ok(auditActions.has('auth.login_success'), 'Audit log should include successful login.');
    assert.ok(auditActions.has('auth.logout'), 'Audit log should include logout.');
    assert.ok(auditActions.has('account.password_change'), 'Audit log should include password change.');
    assert.ok(auditActions.has('account.update'), 'Audit log should include account update.');

    console.log('Account management check passed.');
  } finally {
    await restoreUsers(snapshots);
    await cleanupAuditLogs(usernames);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
