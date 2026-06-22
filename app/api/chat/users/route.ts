import 'dotenv/config';
import { NextResponse } from 'next/server';
import { AuthError, requireSessionUser } from '../../../../src/mastra/auth/session';
import { listMentionableUsers } from '../../../../src/mastra/db/chat';

export const runtime = 'nodejs';

function errorResponse(error: unknown, status = 500) {
  return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
}

export async function GET(request: Request) {
  try {
    await requireSessionUser(request);
    return NextResponse.json({ users: await listMentionableUsers() });
  } catch (error) {
    return errorResponse(error, error instanceof AuthError ? error.status : 500);
  }
}
