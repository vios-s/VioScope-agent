import { randomBytes, scrypt, timingSafeEqual, type BinaryLike } from 'node:crypto';
import { promisify } from 'node:util';
import { createPostgresClient } from './postgres';
import type { PublicTeamProfile } from '../team/public-profiles';

const scryptAsync = promisify(scrypt) as (password: BinaryLike, salt: BinaryLike, keylen: number) => Promise<Buffer>;

export const userRoles = ['administrator', 'pi', 'organizer', 'member', 'viewer', 'service'] as const;
export const userProvisioningStatuses = ['profile_only', 'invited', 'active', 'disabled'] as const;

export type UserRole = (typeof userRoles)[number];
export type UserProvisioningStatus = (typeof userProvisioningStatuses)[number];

export type UserProfileContext = {
  email?: string;
  avatarUrl?: string;
  publicRole?: string;
  publicGroup?: string;
  researchInterests: string[];
  publicInfo: string[];
};

export type UserSeedRecord = {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  role: UserRole;
  provisioningStatus: string;
  source: string;
  sourceProfileId: string | null;
  passwordResetRequired: boolean;
  passwordChangedAt: string | null;
  lastLoginAt: string | null;
};

export type AuthUser = {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  role: UserRole;
  provisioningStatus: UserProvisioningStatus;
  sourceProfileId: string | null;
  aliases: string[];
  profile?: UserProfileContext;
  passwordResetRequired: boolean;
  passwordChangedAt: string | null;
  lastLoginAt: string | null;
};

export type UserAdminRecord = AuthUser & {
  source: string;
  sourceProfileId: string | null;
  hasPassword: boolean;
};

type UserSeedRow = {
  id: string;
  username: string;
  display_name: string;
  email: string | null;
  role: UserRole;
  provisioning_status: UserProvisioningStatus;
  source: string;
  source_profile_id: string | null;
  password_reset_required: boolean;
  password_changed_at: string | null;
  last_login_at: string | null;
};

type AuthUserRow = UserSeedRow & {
  password_hash: string | null;
  has_password?: boolean;
  metadata: Record<string, unknown> | string | null;
};

type LocalUserInput = {
  username: string;
  password: string;
  role: UserRole;
  email?: string;
  displayName?: string;
  passwordResetRequired?: boolean;
  source?: string;
  metadata?: Record<string, unknown>;
};

let ensureUsersTablePromise: Promise<void> | null = null;

function toRecord(row: UserSeedRow): UserSeedRecord {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    email: row.email,
    role: row.role,
    provisioningStatus: row.provisioning_status,
    source: row.source,
    sourceProfileId: row.source_profile_id,
    passwordResetRequired: row.password_reset_required,
    passwordChangedAt: row.password_changed_at,
    lastLoginAt: row.last_login_at,
  };
}

function toAuthUser(row: AuthUserRow): AuthUser {
  const profile = profileFromMetadata(row.metadata, row.email);
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    email: row.email || profile.email || null,
    role: row.role,
    provisioningStatus: row.provisioning_status,
    sourceProfileId: row.source_profile_id,
    aliases: aliasesFromMetadata(row.metadata),
    profile,
    passwordResetRequired: row.password_reset_required,
    passwordChangedAt: row.password_changed_at,
    lastLoginAt: row.last_login_at,
  };
}

function toAdminRecord(row: AuthUserRow): UserAdminRecord {
  return {
    ...toAuthUser(row),
    source: row.source,
    sourceProfileId: row.source_profile_id,
    hasPassword: Boolean(row.has_password ?? row.password_hash),
  };
}

export function isUserRole(role: string): role is UserRole {
  return userRoles.includes(role as UserRole);
}

export function isUserProvisioningStatus(status: string): status is UserProvisioningStatus {
  return userProvisioningStatuses.includes(status as UserProvisioningStatus);
}

function cleanAliases(aliases: string[] = []): string[] {
  return [...new Set(aliases.map((alias) => alias.trim()).filter(Boolean))];
}

function metadataObject(value: Record<string, unknown> | string | null): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return value;
}

function aliasesFromMetadata(value: Record<string, unknown> | string | null): string[] {
  const aliases = metadataObject(value).aliases;
  return Array.isArray(aliases) ? cleanAliases(aliases.filter((alias): alias is string => typeof alias === 'string')) : [];
}

function stringArrayFromMetadata(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())) : [];
}

function profileFromMetadata(value: Record<string, unknown> | string | null, email?: string | null): UserProfileContext {
  const metadata = metadataObject(value);
  const aliases = stringArrayFromMetadata(metadata.aliases);
  const publicInfo = stringArrayFromMetadata(metadata.public_info);
  const metadataEmail = typeof metadata.email === 'string' && metadata.email.trim() ? metadata.email.trim() : undefined;
  const avatarUrl = typeof metadata.avatar_url === 'string' && metadata.avatar_url.trim() ? metadata.avatar_url.trim() : undefined;
  return {
    email: email || metadataEmail || [...aliases, ...publicInfo].find((item) => item.includes('@')),
    avatarUrl,
    publicRole: typeof metadata.public_role === 'string' && metadata.public_role.trim() ? metadata.public_role.trim() : undefined,
    publicGroup: typeof metadata.public_group === 'string' && metadata.public_group.trim() ? metadata.public_group.trim() : undefined,
    researchInterests: stringArrayFromMetadata(metadata.research_interests),
    publicInfo,
  };
}

export function isStrongPassword(password: string): boolean {
  return passwordStrength(password) === 'strong';
}

export function assertStrongPassword(password: string): void {
  if (!isStrongPassword(password)) {
    throw new Error('Password must be strong.');
  }
}

export type PasswordStrength = 'weak' | 'medium' | 'strong';

export function passwordStrength(password: string): PasswordStrength {
  const hasLetter = /[A-Za-z]/.test(password);
  const hasDigit = /\d/.test(password);
  const hasSpecial = /[^A-Za-z0-9]/.test(password);

  if (password.length >= 12 && /[a-z]/.test(password) && /[A-Z]/.test(password) && hasDigit && hasSpecial) {
    return 'strong';
  }
  if (password.length >= 8 && hasLetter && hasDigit && hasSpecial) return 'medium';
  return 'weak';
}

export function assertMediumPassword(password: string): void {
  if (passwordStrength(password) === 'weak') {
    throw new Error('Password must be at least medium: 8+ characters with at least one letter, one number, and one special character.');
  }
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function normalizeEmail(email: string | null | undefined): string {
  return (email || '').trim().toLowerCase();
}

export function assertRequiredEmail(email: string | null | undefined): string {
  const normalized = normalizeEmail(email);
  if (!normalized || !isValidEmail(normalized)) {
    throw new Error('A valid email address is required.');
  }
  return normalized;
}

export async function hashPassword(password: string): Promise<string> {
  if (!password) {
    throw new Error('Password is required.');
  }

  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, 64);
  return `scrypt:v1:${salt.toString('base64url')}:${hash.toString('base64url')}`;
}

export async function verifyPassword(password: string, storedHash?: string | null): Promise<boolean> {
  if (!storedHash) {
    return false;
  }

  const [algorithm, version, saltValue, hashValue, ...extra] = storedHash.split(':');
  if (algorithm !== 'scrypt' || version !== 'v1' || !saltValue || !hashValue || extra.length) {
    return false;
  }

  try {
    const salt = Buffer.from(saltValue, 'base64url');
    const expected = Buffer.from(hashValue, 'base64url');
    const actual = await scryptAsync(password, salt, expected.length);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

function assertUsername(username: string): void {
  if (!/^[a-z0-9][a-z0-9._-]{1,62}[a-z0-9]$/.test(username)) {
    throw new Error('Username must be 3-64 lowercase letters, numbers, dots, underscores, or dashes.');
  }
}

async function ensureUsersTableOnce(): Promise<void> {
  const postgres = createPostgresClient('vioscope-users');

  try {
    await postgres.pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
    await postgres.pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        username TEXT NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9][a-z0-9._-]{1,62}[a-z0-9]$'),
        display_name TEXT NOT NULL,
        email TEXT NOT NULL DEFAULT '',
        role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('administrator', 'pi', 'organizer', 'member', 'viewer', 'service')),
        password_hash TEXT,
        password_reset_required BOOLEAN NOT NULL DEFAULT false,
        password_changed_at TIMESTAMPTZ,
        last_login_at TIMESTAMPTZ,
        auth_provider TEXT NOT NULL DEFAULT 'local',
        provisioning_status TEXT NOT NULL DEFAULT 'profile_only' CHECK (
          provisioning_status IN ('profile_only', 'invited', 'active', 'disabled')
        ),
        source TEXT NOT NULL DEFAULT 'manual',
        source_url TEXT,
        source_profile_id TEXT,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CHECK (email = '' OR email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
        CHECK (provisioning_status <> 'active' OR email <> '')
      )
    `);
    await postgres.pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT NOT NULL DEFAULT ''");
    await postgres.pool.query(`
      UPDATE users
      SET email = lower(trim(COALESCE(NULLIF(email, ''), metadata->>'email', '')))
      WHERE email = '' AND metadata ? 'email'
    `);
    await postgres.pool.query('ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_format_check');
    await postgres.pool.query(`
      DO $$
      BEGIN
        ALTER TABLE users ADD CONSTRAINT users_email_format_check
          CHECK (email = '' OR email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') NOT VALID;
      EXCEPTION WHEN duplicate_object THEN
        NULL;
      END $$;
    `);
    await postgres.pool.query('ALTER TABLE users DROP CONSTRAINT IF EXISTS users_active_email_required_check');
    await postgres.pool.query(`
      DO $$
      BEGIN
        ALTER TABLE users ADD CONSTRAINT users_active_email_required_check
          CHECK (provisioning_status <> 'active' OR email <> '') NOT VALID;
      EXCEPTION WHEN duplicate_object THEN
        NULL;
      END $$;
    `);
    await postgres.pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_required BOOLEAN DEFAULT false');
    await postgres.pool.query('UPDATE users SET password_reset_required = false WHERE password_reset_required IS NULL');
    await postgres.pool.query('ALTER TABLE users ALTER COLUMN password_reset_required SET DEFAULT false');
    await postgres.pool.query('ALTER TABLE users ALTER COLUMN password_reset_required SET NOT NULL');
    await postgres.pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ');
    await postgres.pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ');
    await postgres.pool.query('ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check');
    await postgres.pool.query(`
      DO $$
      BEGIN
        ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('administrator', 'pi', 'organizer', 'member', 'viewer', 'service'));
      EXCEPTION WHEN duplicate_object THEN
        NULL;
      END $$;
    `);
    await postgres.pool.query('CREATE INDEX IF NOT EXISTS users_role_idx ON users (role)');
    await postgres.pool.query(
      'CREATE INDEX IF NOT EXISTS users_provisioning_status_idx ON users (provisioning_status)',
    );
    await postgres.pool.query('CREATE INDEX IF NOT EXISTS users_source_idx ON users (source)');
  } finally {
    await postgres.disconnect();
  }
}

export async function ensureUsersTable(): Promise<void> {
  ensureUsersTablePromise ||= ensureUsersTableOnce().catch((error) => {
    ensureUsersTablePromise = null;
    throw error;
  });
  return ensureUsersTablePromise;
}

async function getAuthUserBy(
  column: 'id' | 'username',
  value: string,
): Promise<{ user: AuthUser; passwordHash: string | null } | null> {
  await ensureUsersTable();
  const postgres = createPostgresClient('vioscope-users');

  try {
    const result = await postgres.pool.query<AuthUserRow>(
      `
        SELECT
          id::text,
          username,
          display_name,
          email,
          role,
          provisioning_status,
          source,
          source_profile_id,
          password_hash,
          metadata,
          password_reset_required,
          password_changed_at::text,
          last_login_at::text
        FROM users
        WHERE ${column} = $1
      `,
      [column === 'username' ? normalizeUsername(value) : value],
    );
    const row = result.rows[0];
    return row ? { user: toAuthUser(row), passwordHash: row.password_hash } : null;
  } finally {
    await postgres.disconnect();
  }
}

export async function getUserById(id: string): Promise<AuthUser | null> {
  return (await getAuthUserBy('id', id))?.user || null;
}

export async function getUserByUsername(username: string): Promise<AuthUser | null> {
  return (await getAuthUserBy('username', username))?.user || null;
}

export async function listUsersForAdmin(): Promise<UserAdminRecord[]> {
  await ensureUsersTable();
  const postgres = createPostgresClient('vioscope-users');

  try {
    const result = await postgres.pool.query<AuthUserRow>(
      `
        SELECT
          id::text,
          username,
          display_name,
          email,
          role,
          provisioning_status,
          source,
          source_profile_id,
          password_hash,
          password_hash IS NOT NULL AS has_password,
          metadata,
          password_reset_required,
          password_changed_at::text,
          last_login_at::text
        FROM users
        ORDER BY
          CASE provisioning_status
            WHEN 'active' THEN 1
            WHEN 'invited' THEN 2
            WHEN 'profile_only' THEN 3
            ELSE 4
          END,
          display_name
      `,
    );
    return result.rows.map(toAdminRecord);
  } finally {
    await postgres.disconnect();
  }
}

export async function authenticateLocalUser(username: string, password: string): Promise<AuthUser | null> {
  const record = await getAuthUserBy('username', username);
  if (!record || record.user.provisioningStatus !== 'active') {
    return null;
  }

  const passwordMatches = await verifyPassword(password, record.passwordHash);
  if (!passwordMatches) {
    return null;
  }

  const postgres = createPostgresClient('vioscope-users');
  try {
    const result = await postgres.pool.query<AuthUserRow>(
      `
        UPDATE users
        SET last_login_at = now(), updated_at = now()
        WHERE id = $1
        RETURNING
          id::text,
          username,
          display_name,
          email,
          role,
          provisioning_status,
          source,
          source_profile_id,
          password_hash,
          metadata,
          password_reset_required,
          password_changed_at::text,
          last_login_at::text
      `,
      [record.user.id],
    );
    const row = result.rows[0];
    return row ? toAuthUser(row) : record.user;
  } finally {
    await postgres.disconnect();
  }
}

export async function changeLocalUserPassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<AuthUser> {
  assertMediumPassword(newPassword);
  const record = await getAuthUserBy('id', userId);
  if (!record || record.user.provisioningStatus !== 'active') {
    throw new Error('User is not active.');
  }

  if (!(await verifyPassword(currentPassword, record.passwordHash))) {
    throw new Error('Current password is incorrect.');
  }

  const passwordHash = await hashPassword(newPassword);
  const postgres = createPostgresClient('vioscope-users');
  try {
    const result = await postgres.pool.query<AuthUserRow>(
      `
        UPDATE users
        SET
          password_hash = $2,
          password_reset_required = false,
          password_changed_at = now(),
          updated_at = now()
        WHERE id = $1
        RETURNING
          id::text,
          username,
          display_name,
          email,
          role,
          provisioning_status,
          source,
          source_profile_id,
          password_hash,
          metadata,
          password_reset_required,
          password_changed_at::text,
          last_login_at::text
      `,
      [userId, passwordHash],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error('User not found.');
    }
    return toAuthUser(row);
  } finally {
    await postgres.disconnect();
  }
}

export async function updateOwnUserProfile(input: {
  userId: string;
  displayName?: string;
  email?: string | null;
  aliases?: string[];
  avatarUrl?: string | null;
}): Promise<AuthUser> {
  await ensureUsersTable();
  const postgres = createPostgresClient('vioscope-users');

  try {
    const currentResult = await postgres.pool.query<AuthUserRow>(
      `
        SELECT
          id::text,
          username,
          display_name,
          email,
          role,
          provisioning_status,
          source,
          source_profile_id,
          password_hash,
          metadata,
          password_reset_required,
          password_changed_at::text,
          last_login_at::text
        FROM users
        WHERE id = $1
      `,
      [input.userId],
    );
    const current = currentResult.rows[0];
    if (!current || current.provisioning_status !== 'active') {
      throw new Error('User is not active.');
    }

    const nextEmail = input.email === undefined ? current.email : assertRequiredEmail(input.email);
    const nextMetadata = metadataObject(current.metadata);
    nextMetadata.email = nextEmail;
    if (input.aliases) {
      nextMetadata.aliases = cleanAliases(input.aliases);
    }
    if (input.avatarUrl !== undefined) {
      if (input.avatarUrl) {
        nextMetadata.avatar_url = input.avatarUrl;
      } else {
        delete nextMetadata.avatar_url;
      }
    }

    const result = await postgres.pool.query<AuthUserRow>(
      `
        UPDATE users
        SET
          display_name = $2,
          email = $3,
          metadata = $4::jsonb,
          updated_at = now()
        WHERE id = $1
        RETURNING
          id::text,
          username,
          display_name,
          email,
          role,
          provisioning_status,
          source,
          source_profile_id,
          password_hash,
          metadata,
          password_reset_required,
          password_changed_at::text,
          last_login_at::text
      `,
      [input.userId, input.displayName?.trim() || current.display_name, nextEmail, JSON.stringify(nextMetadata)],
    );

    const row = result.rows[0];
    if (!row) {
      throw new Error('User not found.');
    }
    return toAuthUser(row);
  } finally {
    await postgres.disconnect();
  }
}

export async function upsertLocalUser(input: LocalUserInput): Promise<UserSeedRecord> {
  const username = normalizeUsername(input.username);
  assertUsername(username);
  const email = assertRequiredEmail(input.email);

  const passwordResetRequired = input.passwordResetRequired ?? false;
  if (!passwordResetRequired) {
    assertMediumPassword(input.password);
  }

  if (!isUserRole(input.role)) {
    throw new Error(`Unsupported role: ${input.role}`);
  }

  const displayName = input.displayName?.trim() || username;
  const passwordHash = await hashPassword(input.password);
  const metadata = { ...(input.metadata || {}), email };
  const postgres = createPostgresClient('vioscope-users');

  try {
    const result = await postgres.pool.query<UserSeedRow>(
      `
        INSERT INTO users (
          username,
          display_name,
          email,
          role,
          password_hash,
          password_reset_required,
          password_changed_at,
          auth_provider,
          provisioning_status,
          source,
          metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $6 THEN NULL ELSE now() END, 'local', 'active', $7, $8::jsonb)
        ON CONFLICT (username) DO UPDATE
        SET
          display_name = EXCLUDED.display_name,
          email = EXCLUDED.email,
          role = EXCLUDED.role,
          password_hash = EXCLUDED.password_hash,
          password_reset_required = EXCLUDED.password_reset_required,
          password_changed_at = EXCLUDED.password_changed_at,
          auth_provider = 'local',
          provisioning_status = 'active',
          source = EXCLUDED.source,
          metadata = users.metadata || EXCLUDED.metadata,
          updated_at = now()
        RETURNING
          id::text,
          username,
          display_name,
          email,
          role,
          provisioning_status,
          source,
          source_profile_id,
          password_reset_required,
          password_changed_at::text,
          last_login_at::text
      `,
      [username, displayName, email, input.role, passwordHash, passwordResetRequired, input.source || 'manual', JSON.stringify(metadata)],
    );

    const row = result.rows[0];
    if (!row) {
      throw new Error(`Failed to upsert local user: ${username}`);
    }

    return toRecord(row);
  } finally {
    await postgres.disconnect();
  }
}

export async function updateUserByAdmin(input: {
  userId: string;
  actorRole?: UserRole;
  displayName?: string;
  role?: UserRole;
  provisioningStatus?: UserProvisioningStatus;
  email?: string | null;
  aliases?: string[];
  avatarUrl?: string | null;
  temporaryPassword?: string;
  passwordResetRequired?: boolean;
}): Promise<UserAdminRecord> {
  await ensureUsersTable();
  const postgres = createPostgresClient('vioscope-users');

  try {
    const currentResult = await postgres.pool.query<AuthUserRow>(
      `
        SELECT
          id::text,
          username,
          display_name,
          email,
          role,
          provisioning_status,
          source,
          source_profile_id,
          password_hash,
          password_hash IS NOT NULL AS has_password,
          metadata,
          password_reset_required,
          password_changed_at::text,
          last_login_at::text
        FROM users
        WHERE id = $1
      `,
      [input.userId],
    );
    const current = currentResult.rows[0];
    if (!current) {
      throw new Error('User not found.');
    }
    if (
      input.actorRole === 'pi' &&
      (['administrator', 'pi', 'service'].includes(current.role) ||
        (input.role && ['administrator', 'pi', 'service'].includes(input.role)))
    ) {
      throw new Error('PI users can only manage member, organizer, and viewer roles.');
    }

    const nextRole = input.role || current.role;
    const nextStatus = input.provisioningStatus || current.provisioning_status;
    const nextDisplayName = input.displayName?.trim() || current.display_name;
    const nextEmail = input.email === undefined ? current.email || '' : normalizeEmail(input.email);
    if (nextStatus === 'active') {
      assertRequiredEmail(nextEmail);
    } else if (nextEmail && !isValidEmail(nextEmail)) {
      throw new Error('Enter a valid email address.');
    }
    const nextMetadata = metadataObject(current.metadata);
    if (nextEmail) {
      nextMetadata.email = nextEmail;
    } else {
      delete nextMetadata.email;
    }
    if (input.aliases) {
      nextMetadata.aliases = cleanAliases(input.aliases);
    }
    if (input.avatarUrl !== undefined) {
      if (input.avatarUrl) {
        nextMetadata.avatar_url = input.avatarUrl;
      } else {
        delete nextMetadata.avatar_url;
      }
    }

    const temporaryPassword = input.temporaryPassword?.trim();
    const nextPasswordHash = temporaryPassword ? await hashPassword(temporaryPassword) : current.password_hash;
    if (nextStatus === 'active' && !nextPasswordHash) {
      throw new Error('Set a temporary password before activating this user.');
    }

    const result = await postgres.pool.query<AuthUserRow>(
      `
        UPDATE users
        SET
          display_name = $2,
          role = $3,
          provisioning_status = $4,
          email = $5,
          metadata = $6::jsonb,
          password_hash = $7,
          password_reset_required = $8,
          password_changed_at = CASE WHEN $9 THEN NULL ELSE password_changed_at END,
          updated_at = now()
        WHERE id = $1
        RETURNING
          id::text,
          username,
          display_name,
          email,
          role,
          provisioning_status,
          source,
          source_profile_id,
          password_hash,
          password_hash IS NOT NULL AS has_password,
          metadata,
          password_reset_required,
          password_changed_at::text,
          last_login_at::text
      `,
      [
        input.userId,
        nextDisplayName,
        nextRole,
        nextStatus,
        nextEmail,
        JSON.stringify(nextMetadata),
        nextPasswordHash,
        temporaryPassword ? true : input.passwordResetRequired ?? current.password_reset_required,
        Boolean(temporaryPassword),
      ],
    );

    const row = result.rows[0];
    if (!row) {
      throw new Error('User not found.');
    }
    return toAdminRecord(row);
  } finally {
    await postgres.disconnect();
  }
}

export async function upsertPublicTeamProfiles(
  profiles: PublicTeamProfile[],
  options: {
    sourceUrl: string;
  },
): Promise<UserSeedRecord[]> {
  const postgres = createPostgresClient('vioscope-users');

  try {
    const records: UserSeedRecord[] = [];
    for (const profile of profiles) {
      const metadata = {
        public_group: profile.group,
        public_role: profile.role,
        research_interests: profile.researchInterests,
        public_links: profile.publicLinks,
        public_info: profile.publicInfo,
      };
      const result = await postgres.pool.query<UserSeedRow>(
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
            source_url,
            source_profile_id,
            metadata
          )
          VALUES ($1, $2, '', 'viewer', NULL, 'local', 'profile_only', 'vios_public_team', $3, $4, $5::jsonb)
          ON CONFLICT (username) DO UPDATE
          SET
            display_name = EXCLUDED.display_name,
            source = EXCLUDED.source,
            source_url = EXCLUDED.source_url,
            source_profile_id = EXCLUDED.source_profile_id,
            metadata = users.metadata || EXCLUDED.metadata,
            updated_at = now()
          RETURNING
            id::text,
            username,
            display_name,
            email,
            role,
            provisioning_status,
            source,
            source_profile_id,
            password_reset_required,
            password_changed_at::text,
            last_login_at::text
        `,
        [profile.username, profile.name, options.sourceUrl, profile.sourceId || null, JSON.stringify(metadata)],
      );
      const row = result.rows[0];
      if (row) {
        records.push(toRecord(row));
      }
    }

    return records;
  } finally {
    await postgres.disconnect();
  }
}
