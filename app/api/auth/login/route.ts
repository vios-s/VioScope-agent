import 'dotenv/config';
import { NextResponse } from 'next/server';
import { authenticateLocalUser } from '../../../../src/mastra/db/users';
import { setSessionCookie } from '../../../../src/mastra/auth/session';
import { recordAuditLog } from '../../../../src/mastra/db/audit-log';

export const runtime = 'nodejs';

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const username = text(body.username);
    const password = text(body.password);
    if (!username || !password) {
      await recordAuditLog({
        action: 'auth.login_failure',
        targetType: 'user',
        targetId: username || null,
        summary: 'Login request missing username or password.',
        metadata: { reason: 'missing_credentials' },
      });
      return NextResponse.json({ error: 'Username and password are required.' }, { status: 400 });
    }

    const user = await authenticateLocalUser(username, password);
    if (!user) {
      await recordAuditLog({
        action: 'auth.login_failure',
        targetType: 'user',
        targetId: username,
        summary: 'Login failed.',
        metadata: { reason: 'invalid_credentials_or_inactive' },
      });
      return NextResponse.json({ error: 'Invalid username or password.' }, { status: 401 });
    }

    await recordAuditLog({
      actor: user,
      action: 'auth.login_success',
      targetType: 'user',
      targetId: user.username,
      summary: 'User logged in.',
      metadata: { passwordResetRequired: user.passwordResetRequired },
    });
    const response = NextResponse.json({ user });
    setSessionCookie(response, user);
    return response;
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Login failed.' }, { status: 500 });
  }
}
