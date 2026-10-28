import 'dotenv/config';
import { NextResponse } from 'next/server';
import { requireSessionUser } from '../../../../../src/mastra/auth/session';
import { errorResponse } from '../../../../../src/mastra/http/error-response';
import { getProjectForUser } from '../../../../../src/mastra/db/projects';
import { readMeetingWorkflow } from '../../../../../src/mastra/theme-meetings/workflow';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const user = await requireSessionUser(request);
    const { projectId } = await context.params;
    const project = await getProjectForUser(projectId, user);
    const state = await readMeetingWorkflow();
    return NextResponse.json({ actions: state.actions.filter((action) => action.projectId === project.id) });
  } catch (error) { return errorResponse(error, 404); }
}
