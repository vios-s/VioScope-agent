import 'dotenv/config';
import { NextResponse } from 'next/server';
import { AuthError, requireSessionUser } from '../../../../src/mastra/auth/session';
import { recordAuditLog } from '../../../../src/mastra/db/audit-log';
import {
  isUserProvisioningStatus,
  isUserRole,
  updateUserByAdmin,
  type AuthUser,
  type UserProvisioningStatus,
  type UserRole,
} from '../../../../src/mastra/db/users';

export const runtime = 'nodejs';

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function textArray(value: unknown): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new Error('aliases must be an array.');
  }

  return value.map((item) => text(item)).filter((item): item is string => Boolean(item));
}

function role(value: unknown): UserRole | undefined {
  const nextRole = text(value);
  if (!nextRole) return undefined;
  if (!isUserRole(nextRole)) {
    throw new Error('Invalid role.');
  }
  return nextRole;
}

function provisioningStatus(value: unknown): UserProvisioningStatus | undefined {
  const status = text(value);
  if (!status) return undefined;
  if (!isUserProvisioningStatus(status)) {
    throw new Error('Invalid provisioning status.');
  }
  return status;
}

function optionalText(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new Error('Expected text value.');
  }
  return value.trim() || null;
}

function validateEmail(email: string | null | undefined) {
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Enter a valid email address.');
  }
}

function validateAvatarUrl(avatarUrl: string | null | undefined) {
  if (!avatarUrl) return;
  if (avatarUrl.length > 750_000) {
    throw new Error('Avatar image is too large.');
  }
  if (!/^https?:\/\//.test(avatarUrl) && !/^data:image\/(png|jpe?g|webp|gif);base64,/.test(avatarUrl)) {
    throw new Error('Avatar must be an image URL or uploaded image.');
  }
}

function errorResponse(error: unknown, status = 500) {
  return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
}

async function requireUserManager(request: Request): Promise<AuthUser> {
  const user = await requireSessionUser(request);
  if (user.role !== 'administrator' && user.role !== 'pi') {
    throw new AuthError('Administrator or PI permission is required.', 403, 'forbidden');
  }
  return user;
}

export async function PATCH(request: Request, context: { params: Promise<{ userId: string }> }) {
  try {
    const admin = await requireUserManager(request);
    const { userId } = await context.params;
    const body = (await request.json()) as Record<string, unknown>;
    const nextRole = role(body.role);
    const nextStatus = provisioningStatus(body.provisioningStatus);
    const email = optionalText(body.email);
    const avatarUrl = optionalText(body.avatarUrl);

    validateEmail(email);
    validateAvatarUrl(avatarUrl);

    if (admin.id === userId && nextRole && nextRole !== 'administrator') {
      throw new Error('You cannot remove your own administrator role.');
    }

    if (admin.id === userId && nextStatus && nextStatus !== 'active') {
      throw new Error('You cannot disable your own account.');
    }

    const user = await updateUserByAdmin({
      userId,
      actorRole: admin.role,
      displayName: text(body.displayName),
      role: nextRole,
      provisioningStatus: nextStatus,
      email,
      aliases: textArray(body.aliases),
      avatarUrl,
      temporaryPassword: text(body.temporaryPassword),
      passwordResetRequired: typeof body.passwordResetRequired === 'boolean' ? body.passwordResetRequired : undefined,
    });

    const changedFields = [
      body.displayName !== undefined ? 'displayName' : null,
      nextRole ? 'role' : null,
      nextStatus ? 'provisioningStatus' : null,
      email !== undefined ? 'email' : null,
      body.aliases !== undefined ? 'aliases' : null,
      avatarUrl !== undefined ? 'avatar' : null,
      body.temporaryPassword !== undefined ? 'temporaryPassword' : null,
      body.passwordResetRequired !== undefined ? 'passwordResetRequired' : null,
    ].filter((field): field is string => Boolean(field));
    await recordAuditLog({
      actor: admin,
      action: 'admin.user_update',
      targetType: 'user',
      targetId: user.username,
      summary: 'Admin updated user.',
      metadata: {
        changedFields,
        role: user.role,
        provisioningStatus: user.provisioningStatus,
      },
    });
    return NextResponse.json({ user });
  } catch (error) {
    return errorResponse(error, error instanceof AuthError ? error.status : 400);
  }
}
