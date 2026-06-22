import 'dotenv/config';
import { NextResponse } from 'next/server';
import { authenticateLocalUser } from '../../../../src/mastra/db/users';
import { setSessionCookie } from '../../../../src/mastra/auth/session';

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
      return NextResponse.json({ error: 'Username and password are required.' }, { status: 400 });
    }

    const user = await authenticateLocalUser(username, password);
    if (!user) {
      return NextResponse.json({ error: 'Invalid username or password.' }, { status: 401 });
    }

    const response = NextResponse.json({ user });
    setSessionCookie(response, user);
    return response;
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Login failed.' }, { status: 500 });
  }
}
