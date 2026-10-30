import 'dotenv/config';
import { NextResponse } from 'next/server';
import { AuthError, requireSessionUser } from '../../../../src/mastra/auth/session';
import { coordinatorThemesByUsername } from '../../../../src/mastra/theme-meetings/coordinators';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const user = await requireSessionUser(request, { allowPasswordReset: true });
    // Theme coordinator label for the account menu; derived from theme configuration, not the role.
    return NextResponse.json({ user, coordinatorThemes: (await coordinatorThemesByUsername()).get(user.username.toLowerCase()) || [] });
  } catch (error) {
    const status = error instanceof AuthError ? error.status : 500;
    // The signed-out shell probes with ?optional=1: "no session" is an expected answer, not an error.
    if (status === 401 && new URL(request.url).searchParams.has('optional')) return NextResponse.json({ user: null });
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not read session.' }, { status });
  }
}
