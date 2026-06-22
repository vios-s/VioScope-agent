import 'dotenv/config';
import { NextResponse } from 'next/server';
import { AuthError, canSeeAll, isUserName, requireSessionUser } from '../../../../src/mastra/auth/session';
import type { AuthUser } from '../../../../src/mastra/db/users';
import { getReviewRun } from '../../../../src/mastra/db/review-runs';
import type { ReviewRunRecord } from '../../../../src/mastra/db/review-runs';

export const runtime = 'nodejs';

function errorResponse(error: unknown, status = 500) {
  return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
}

function canAccessRun(run: Pick<ReviewRunRecord, 'initiator' | 'cooperators' | 'reviewer'>, user: AuthUser): boolean {
  return (
    canSeeAll(user) ||
    isUserName(run.initiator, user) ||
    isUserName(run.reviewer, user) ||
    run.cooperators.some((cooperator) => isUserName(cooperator, user))
  );
}

export async function GET(request: Request, context: { params: Promise<{ runId: string }> }) {
  try {
    const user = await requireSessionUser(request);
    const { runId } = await context.params;
    const run = await getReviewRun(runId);
    if (!canAccessRun(run, user)) {
      throw new AuthError('You can only view your own review runs.', 403, 'forbidden');
    }
    return NextResponse.json({ run });
  } catch (error) {
    return errorResponse(error, error instanceof AuthError ? error.status : 404);
  }
}
