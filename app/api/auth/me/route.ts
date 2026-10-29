import 'dotenv/config';
import { NextResponse } from 'next/server';
import { AuthError, requireSessionUser } from '../../../../src/mastra/auth/session';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    return NextResponse.json({ user: await requireSessionUser(request, { allowPasswordReset: true }) });
  } catch (error) {
    const status = error instanceof AuthError ? error.status : 500;
    // The signed-out shell probes with ?optional=1: "no session" is an expected answer, not an error.
    if (status === 401 && new URL(request.url).searchParams.has('optional')) return NextResponse.json({ user: null });
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not read session.' }, { status });
  }
}
