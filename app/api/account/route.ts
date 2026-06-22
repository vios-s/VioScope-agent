import 'dotenv/config';
import { NextResponse } from 'next/server';
import { AuthError, requireSessionUser, setSessionCookie } from '../../../src/mastra/auth/session';
import { recordAuditLog } from '../../../src/mastra/db/audit-log';
import { updateOwnUserProfile } from '../../../src/mastra/db/users';

export const runtime = 'nodejs';

function optionalText(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new Error('Expected text value.');
  }
  return value.trim() || null;
}

function textArray(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new Error('aliases must be an array.');
  }
  return value.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean);
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

export async function PATCH(request: Request) {
  try {
    const user = await requireSessionUser(request);
    const body = (await request.json()) as Record<string, unknown>;
    const email = optionalText(body.email);
    const avatarUrl = optionalText(body.avatarUrl);

    validateEmail(email);
    validateAvatarUrl(avatarUrl);

    const nextUser = await updateOwnUserProfile({
      userId: user.id,
      displayName: optionalText(body.displayName) || undefined,
      email,
      aliases: textArray(body.aliases),
      avatarUrl,
    });
    const changedFields = [
      nextUser.displayName !== user.displayName ? 'displayName' : null,
      nextUser.email !== user.email ? 'email' : null,
      nextUser.aliases.join('\n') !== user.aliases.join('\n') ? 'aliases' : null,
      (nextUser.profile?.avatarUrl || null) !== (user.profile?.avatarUrl || null) ? 'avatar' : null,
    ].filter((field): field is string => Boolean(field));
    await recordAuditLog({
      actor: user,
      action: 'account.update',
      targetType: 'user',
      targetId: user.username,
      summary: changedFields.length ? 'User updated account details.' : 'User saved account details.',
      metadata: { changedFields },
    });
    const response = NextResponse.json({ user: nextUser });
    setSessionCookie(response, nextUser);
    return response;
  } catch (error) {
    const status = error instanceof AuthError ? error.status : 400;
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not update account.' }, { status });
  }
}
