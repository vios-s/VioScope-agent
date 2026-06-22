import 'dotenv/config';
import { NextResponse } from 'next/server';
import { AuthError, requireSessionUser, setSessionCookie } from '../../../../src/mastra/auth/session';
import { changeLocalUserPassword } from '../../../../src/mastra/db/users';

export const runtime = 'nodejs';

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export async function POST(request: Request) {
  try {
    const user = await requireSessionUser(request, { allowPasswordReset: true });
    const body = (await request.json()) as Record<string, unknown>;
    const currentPassword = text(body.currentPassword);
    const newPassword = text(body.newPassword);
    if (!currentPassword || !newPassword) {
      return NextResponse.json({ error: 'Current password and new password are required.' }, { status: 400 });
    }

    const nextUser = await changeLocalUserPassword(user.id, currentPassword, newPassword);
    const response = NextResponse.json({ user: nextUser });
    setSessionCookie(response, nextUser);
    return response;
  } catch (error) {
    const status = error instanceof AuthError ? error.status : 400;
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not change password.' }, { status });
  }
}
