import 'dotenv/config';
import { NextResponse } from 'next/server';
import { AuthError, requireSessionUser } from '../../../../src/mastra/auth/session';
import { listChatSessionsForUser } from '../../../../src/mastra/db/chat';

export const runtime = 'nodejs';

function errorResponse(error: unknown, status = 500) {
  return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
}

export async function GET(request: Request) {
  try {
    const user = await requireSessionUser(request);
    return NextResponse.json({ sessions: await listChatSessionsForUser(user.id) });
  } catch (error) {
    return errorResponse(error, error instanceof AuthError ? error.status : 500);
  }
}
