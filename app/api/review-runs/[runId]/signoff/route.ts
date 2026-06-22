import 'dotenv/config';
import { NextResponse } from 'next/server';
import { AuthError, canSeeAll, requireSessionUser } from '../../../../../src/mastra/auth/session';
import {
  updateReviewCheckSignoff,
  type ReviewSignoffStatus,
} from '../../../../../src/mastra/db/review-runs';

export const runtime = 'nodejs';

const signoffStatuses = new Set<ReviewSignoffStatus>(['pending', 'accepted', 'needs_revision', 'rejected']);

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function errorResponse(error: unknown, status = 500) {
  return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
}

export async function PATCH(request: Request, context: { params: Promise<{ runId: string }> }) {
  try {
    const user = await requireSessionUser(request);
    if (!canSeeAll(user)) {
      throw new AuthError('Only administrators and PIs can sign off review checks.', 403, 'forbidden');
    }

    const { runId } = await context.params;
    const body = (await request.json()) as Record<string, unknown>;
    const skillName = text(body.skillName);
    const signoffStatus = text(body.signoffStatus) as ReviewSignoffStatus | undefined;

    if (!skillName || !signoffStatus) {
      throw new Error('skillName and signoffStatus are required.');
    }

    if (!signoffStatuses.has(signoffStatus)) {
      throw new Error(`Invalid signoffStatus: ${signoffStatus}`);
    }

    const run = await updateReviewCheckSignoff({
      runId,
      skillName,
      signoffStatus,
      reviewerNote: text(body.reviewerNote),
      signedOffBy: text(body.signedOffBy) || user.displayName,
    });

    return NextResponse.json({ run });
  } catch (error) {
    return errorResponse(error, error instanceof AuthError ? error.status : 400);
  }
}
