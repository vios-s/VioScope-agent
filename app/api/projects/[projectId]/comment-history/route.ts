import 'dotenv/config';
import { NextResponse } from 'next/server';
import { requireSessionUser } from '../../../../../src/mastra/auth/session';
import { errorResponse } from '../../../../../src/mastra/http/error-response';
import { listOwnRemovedUpdateComments } from '../../../../../src/mastra/db/projects';

export const runtime = 'nodejs';

export async function GET(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const actor = await requireSessionUser(request);
    const { projectId } = await context.params;
    return NextResponse.json({ comments: await listOwnRemovedUpdateComments(projectId, actor) });
  } catch (error) {
    return errorResponse(error, 404);
  }
}
