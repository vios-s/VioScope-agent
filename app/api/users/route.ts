import 'dotenv/config';
import { NextResponse } from 'next/server';
import { AuthError, requireSessionUser } from '../../../src/mastra/auth/session';
import { recordAuditLog } from '../../../src/mastra/db/audit-log';
import {
  isUserPosition,
  isUserRole,
  listUsersForAdmin,
  upsertLocalUser,
  type AuthUser,
  type UserPosition,
  type UserRole,
} from '../../../src/mastra/db/users';

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

function errorResponse(error: unknown, status = 500) {
  return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
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
    throw new Error('PI users can only create member or organizer accounts.');
  }
}

function parseRole(value: unknown): UserRole {
  const role = text(value) || 'member';
  if (!isUserRole(role)) {
    throw new Error('Invalid role.');
  }

  return role;
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
    return NextResponse.json({ users: await listUsersForAdmin() });
  } catch (error) {
    return errorResponse(error, error instanceof AuthError ? error.status : 500);
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
    const temporaryPassword = text(body.temporaryPassword) || username;
    validateEmail(email);
    assertAssignableRole(actor, nextRole);

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
    return NextResponse.json({ users: await listUsersForAdmin() });
  } catch (error) {
    return errorResponse(error, error instanceof AuthError ? error.status : 400);
  }
}
