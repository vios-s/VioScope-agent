import 'dotenv/config';
import { NextResponse } from 'next/server';
import { AuthError, canSeeAll, isUserName, requireSessionUser } from '../../../../src/mastra/auth/session';
import { submitThemeMeetingUpdate } from '../../../../src/mastra/theme-meetings/planner';
import { themeUpdateTypeSchema } from '../../../../src/mastra/theme-meetings/schema';

export const runtime = 'nodejs';

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function errorResponse(error: unknown, status = 500) {
  return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
}

export async function POST(request: Request) {
  try {
    const user = await requireSessionUser(request);
    const body = (await request.json()) as Record<string, unknown>;
    const themeId = text(body.themeId);
    const member = text(body.member);
    const progressText = text(body.progressText);
    const parsedUpdateType = themeUpdateTypeSchema.safeParse(body.updateType);

    if (!themeId || !member || !progressText || !parsedUpdateType.success) {
      throw new Error('themeId, member, updateType, and progressText are required.');
    }

    if (!canSeeAll(user) && !isUserName(member, user)) {
      throw new AuthError('Members can only submit their own update.', 403, 'forbidden');
    }

    const result = await submitThemeMeetingUpdate({
      meetingDate: text(body.meetingDate),
      themeId,
      member,
      updateType: parsedUpdateType.data,
      progressText,
      questions: text(body.questions),
      submittedVia: 'dashboard',
    });

    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error, error instanceof AuthError ? error.status : 400);
  }
}
