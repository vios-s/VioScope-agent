import 'dotenv/config';
import { NextResponse } from 'next/server';
import { requireSessionUser } from '../../../../../src/mastra/auth/session';
import { errorResponse } from '../../../../../src/mastra/http/error-response';
import { getProjectIdeaOrigin } from '../../../../../src/mastra/db/idea-checks';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const user = await requireSessionUser(request);
    const { projectId } = await context.params;
    return NextResponse.json({ origin: await getProjectIdeaOrigin(projectId, user) });
  } catch (error) { return errorResponse(error, 404); }
}
