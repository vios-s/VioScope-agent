import 'dotenv/config';
import { NextResponse } from 'next/server';
import { AuthError, canSeeAll, isUserName, requireSessionUser } from '../../../src/mastra/auth/session';
import type { AuthUser } from '../../../src/mastra/db/users';
import { listReviewRuns, saveReviewRun, type ReviewSignoffStatus, type ReviewVerdict } from '../../../src/mastra/db/review-runs';
import type { ReviewRunSummary } from '../../../src/mastra/db/review-runs';

export const runtime = 'nodejs';

const signoffStatuses = new Set<ReviewSignoffStatus>(['pending', 'accepted', 'needs_revision', 'rejected']);
const verdicts = new Set<ReviewVerdict>(['CLEARED', 'CONDITIONAL', 'SLIDE']);

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function textArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => text(item)).filter((item): item is string => Boolean(item));
}

function errorResponse(error: unknown, status = 500) {
  return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
}

function canAccessRun(run: Pick<ReviewRunSummary, 'initiator' | 'cooperators' | 'reviewer'>, user: AuthUser): boolean {
  return (
    canSeeAll(user) ||
    isUserName(run.initiator, user) ||
    isUserName(run.reviewer, user) ||
    run.cooperators.some((cooperator) => isUserName(cooperator, user))
  );
}

export async function GET(request: Request) {
  try {
    const user = await requireSessionUser(request);
    const url = new URL(request.url);
    const limit = Number.parseInt(url.searchParams.get('limit') || '20', 10);
    const runs = await listReviewRuns(Number.isFinite(limit) ? limit : 20);
    return NextResponse.json({ runs: runs.filter((run) => canAccessRun(run, user)) });
  } catch (error) {
    return errorResponse(error, error instanceof AuthError ? error.status : 500);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireSessionUser(request);
    const body = (await request.json()) as Record<string, unknown>;
    const checks = Array.isArray(body.checks) ? body.checks : [];

    const parsedChecks = checks.map((rawCheck) => {
      const check = rawCheck as Record<string, unknown>;
      const skillName = text(check.skillName);
      const skillLabel = text(check.skillLabel);
      const verdict = text(check.verdict) as ReviewVerdict | undefined;
      const reportMarkdown = text(check.reportMarkdown);
      const resultJson = check.resultJson;
      const signoffStatus = (text(check.signoffStatus) || 'pending') as ReviewSignoffStatus;

      if (!skillName || !skillLabel || !verdict || !reportMarkdown || !resultJson) {
        throw new Error('Each check must include skillName, skillLabel, verdict, reportMarkdown, and resultJson.');
      }

      if (!verdicts.has(verdict)) {
        throw new Error(`Invalid verdict: ${verdict}`);
      }

      if (!signoffStatuses.has(signoffStatus)) {
        throw new Error(`Invalid signoffStatus: ${signoffStatus}`);
      }

      return {
        skillName,
        skillLabel,
        verdict,
        reportMarkdown,
        resultJson,
        signoffStatus,
        reviewerNote: text(check.reviewerNote),
        signedOffBy: text(check.signedOffBy),
      };
    });

    const draftName = text(body.draftName);
    if (!draftName) {
      throw new Error('draftName is required.');
    }

    const run = await saveReviewRun({
      id: text(body.id),
      projectName: text(body.projectName),
      draftName,
      targetVenue: text(body.targetVenue),
      deadline: text(body.deadline),
      initiator: canSeeAll(user) ? text(body.initiator) : user.displayName,
      piOrSeniorReviewer: text(body.piOrSeniorReviewer),
      cooperators: textArray(body.cooperators),
      reviewer: canSeeAll(user) ? text(body.reviewer) : user.displayName,
      metadata: typeof body.metadata === 'object' && body.metadata !== null ? (body.metadata as Record<string, unknown>) : {},
      checks: parsedChecks,
    });

    return NextResponse.json({ run });
  } catch (error) {
    return errorResponse(error, error instanceof AuthError ? error.status : 400);
  }
}
