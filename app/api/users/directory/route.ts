import 'dotenv/config';
import { NextResponse } from 'next/server';
import { requireSessionUser } from '../../../../src/mastra/auth/session';
import { errorResponse } from '../../../../src/mastra/http/error-response';
import { listActiveAccountDirectory } from '../../../../src/mastra/db/users';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    await requireSessionUser(request);
    return NextResponse.json({ users: await listActiveAccountDirectory() });
  } catch (error) {
    return errorResponse(error, 500);
  }
}
