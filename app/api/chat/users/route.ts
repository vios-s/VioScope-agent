import 'dotenv/config';
import { NextResponse } from 'next/server';
import { requireSessionUser } from '../../../../src/mastra/auth/session';
import { errorResponse } from '../../../../src/mastra/http/error-response';
import { listMentionableUsers } from '../../../../src/mastra/db/chat';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    await requireSessionUser(request);
    return NextResponse.json({ users: await listMentionableUsers() });
  } catch (error) {
    return errorResponse(error, 500);
  }
}
