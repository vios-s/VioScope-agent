import { createHmac, timingSafeEqual } from 'node:crypto';
import type { NextResponse } from 'next/server';
import { getUserById, type AuthUser } from '../db/users';

export const sessionCookieName = 'vioscope_session';
const sessionMaxAgeSeconds = 60 * 60 * 24 * 7;

type SessionPayload = {
  sub: string;
  iat: number;
  exp: number;
};

export class AuthError extends Error {
  constructor(
    message: string,
    public status = 401,
    public code = 'auth_required',
  ) {
    super(message);
  }
}

function authSecret(): string {
  if (process.env.AUTH_SECRET) {
    return process.env.AUTH_SECRET;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('AUTH_SECRET is required in production.');
  }

  return 'vioscope-local-dev-auth-secret';
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function sign(value: string): string {
  return createHmac('sha256', authSecret()).update(value).digest('base64url');
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function cookieValue(request: Request, name: string): string | undefined {
  return request.headers
    .get('cookie')
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

export function createSessionToken(user: AuthUser): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    sub: user.id,
    iat: now,
    exp: now + sessionMaxAgeSeconds,
  };
  const body = base64url(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

export function verifySessionToken(token?: string): SessionPayload | null {
  if (!token) {
    return null;
  }

  const [body, signature, ...extra] = token.split('.');
  if (!body || !signature || extra.length || !safeEqual(sign(body), signature)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload;
    if (!payload.sub || !payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export async function sessionUserFromRequest(request: Request): Promise<AuthUser | null> {
  const payload = verifySessionToken(cookieValue(request, sessionCookieName));
  return payload ? getUserById(payload.sub) : null;
}

export async function requireSessionUser(
  request: Request,
  options: { allowPasswordReset?: boolean } = {},
): Promise<AuthUser> {
  const user = await sessionUserFromRequest(request);
  if (!user || user.provisioningStatus !== 'active') {
    throw new AuthError('Please log in.', 401, 'auth_required');
  }

  if (user.passwordResetRequired && !options.allowPasswordReset) {
    throw new AuthError('Password change required.', 403, 'password_reset_required');
  }

  return user;
}

export async function requireAdministrator(request: Request): Promise<AuthUser> {
  const user = await requireSessionUser(request);
  if (user.role !== 'administrator') {
    throw new AuthError('Administrator permission is required.', 403, 'forbidden');
  }

  return user;
}

export function setSessionCookie(response: NextResponse, user: AuthUser): void {
  response.cookies.set(sessionCookieName, createSessionToken(user), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: sessionMaxAgeSeconds,
  });
}

export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set(sessionCookieName, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });
}

export function canSeeAll(user: AuthUser): boolean {
  return user.role === 'administrator' || user.role === 'pi';
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function userAliases(user: AuthUser): string[] {
  const displayName = normalizeName(user.displayName);
  return [
    normalizeName(user.username),
    displayName,
    displayName.split(' ')[0],
    ...user.aliases.map(normalizeName),
  ].filter(Boolean);
}

export function isUserName(value: string | null | undefined, user: AuthUser): boolean {
  const normalized = value ? normalizeName(value) : '';
  return Boolean(normalized && userAliases(user).includes(normalized));
}
