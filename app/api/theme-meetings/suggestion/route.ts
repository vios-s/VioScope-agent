import 'dotenv/config';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { AuthError, requireSessionUser } from '../../../../src/mastra/auth/session';
import { getProjectForUser } from '../../../../src/mastra/db/projects';
import { errorResponse } from '../../../../src/mastra/http/error-response';
import { meetingSuggestionContext } from '../../../../src/mastra/theme-meetings/guidance';
import { generateMeetingSuggestion } from '../../../../src/mastra/theme-meetings/suggestion';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  try {
    const user = await requireSessionUser(request);
    const { projectId } = z.object({ projectId: z.string().uuid() }).strict().parse(await request.json());
    const project = await getProjectForUser(projectId, user);
    if (project.lifecycle !== 'active') throw new Error('Choose an active project.');
    const context = meetingSuggestionContext(project);
    const result = await generateMeetingSuggestion(context);
    const currentUser = await requireSessionUser(request);
    const current = await getProjectForUser(projectId, currentUser);
    if (current.lifecycle !== 'active' || JSON.stringify(meetingSuggestionContext(current)) !== JSON.stringify(context)) {
      throw new AuthError('The project changed while generating advice. Refresh and try again.', 409, 'conflict');
    }
    return NextResponse.json(result);
  } catch (error) { return errorResponse(error, 400); }
}
