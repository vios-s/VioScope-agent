import 'dotenv/config';
import { NextResponse } from 'next/server';
import { AuthError, requireSessionUser } from '../../../src/mastra/auth/session';
import { errorResponse } from '../../../src/mastra/http/error-response';
import { recordAuditLog } from '../../../src/mastra/db/audit-log';
import {
  assertMediumPassword,
  getUserByUsername,
  isUserPosition,
  listUsersForAdmin,
  parseAssignableUserRole,
  upsertLocalUser,
  type AuthUser,
  type UserPosition,
  type UserRole,
} from '../../../src/mastra/db/users';
import { withCoordinatorThemes } from '../../../src/mastra/theme-meetings/coordinators';

export const runtime = 'nodejs';

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function textArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => text(item)).filter((item): item is string => Boolean(item));
}

function validateEmail(email: string | undefined) {
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Enter a valid email address.');
  }
}

async function requireUserManager(request: Request): Promise<AuthUser> {
  const user = await requireSessionUser(request);
  if (user.role !== 'administrator' && user.role !== 'pi') {
    throw new AuthError('Administrator or PI permission is required.', 403, 'forbidden');
  }
  return user;
}

function assertAssignableRole(actor: AuthUser, role: UserRole) {
  if (actor.role === 'pi' && ['administrator', 'pi', 'service', 'viewer'].includes(role)) {
    throw new Error('PI users can only create member accounts.');
  }
}

function parseRole(value: unknown): UserRole {
  return parseAssignableUserRole(text(value) || 'member');
}

function parsePosition(value: unknown): UserPosition | null {
  const position = text(value);
  if (!position) return null;
  if (!isUserPosition(position)) {
    throw new Error('Invalid position.');
  }
  return position;
}

export async function GET(request: Request) {
  try {
    await requireUserManager(request);
    return NextResponse.json({ users: await withCoordinatorThemes(await listUsersForAdmin()) });
  } catch (error) {
    return errorResponse(error, 500);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireUserManager(request);
    const body = (await request.json()) as Record<string, unknown>;
    const username = text(body.username);
    const email = text(body.email);
    const nextRole = parseRole(body.role);
    const position = parsePosition(body.position);
    if (!username) {
      throw new Error('Username is required.');
    }
    validateEmail(email);
    assertAssignableRole(actor, nextRole);
    // "Add member" must never overwrite an existing account (password, role, status); only a
    // profile-only record from the public team cache may be activated this way.
    const existing = await getUserByUsername(username);
    if (existing && existing.provisioningStatus !== 'profile_only') {
      throw new Error('A member with this username already exists. Use Edit to change their details.');
    }
    // No default: the temporary password must meet the normal rule and is changed at first sign-in.
    const temporaryPassword = text(body.temporaryPassword);
    if (!temporaryPassword) throw new Error('Set a temporary password for the new member.');
    assertMediumPassword(temporaryPassword);

    const createdUser = await upsertLocalUser({
      username,
      password: temporaryPassword,
      email,
      displayName: text(body.displayName),
      role: nextRole,
      position,
      passwordResetRequired: true,
      source: 'manual',
      metadata: { aliases: textArray(body.aliases), email, position, created_by: 'admin-ui' },
    });

    await recordAuditLog({
      actor,
      action: 'admin.user_create',
      targetType: 'user',
      targetId: createdUser.username,
      summary: 'Admin created local user.',
      metadata: {
        role: createdUser.role,
        position,
        provisioningStatus: createdUser.provisioningStatus,
        passwordResetRequired: createdUser.passwordResetRequired,
      },
    });
    return NextResponse.json({ users: await withCoordinatorThemes(await listUsersForAdmin()) });
  } catch (error) {
    return errorResponse(error, 400);
  }
}
