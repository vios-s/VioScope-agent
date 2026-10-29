import { z } from 'zod';
import { NextResponse } from 'next/server';
import { requireSessionUser } from '../../../../src/mastra/auth/session';
import { errorResponse } from '../../../../src/mastra/http/error-response';
import { getSkeletonReview, decideSkeletonReview } from '../../../../src/mastra/db/skeleton-reviews';
import { recordAuditLog } from '../../../../src/mastra/db/audit-log';
import { withDatabaseTransaction } from '../../../../src/mastra/db/postgres';
export const runtime = 'nodejs';
type Context = { params: Promise<{ reviewId: string }> };
export async function GET(request: Request, context: Context) {
  try { const user = await requireSessionUser(request); const id = z.string().uuid().parse((await context.params).reviewId); return NextResponse.json({ review: await getSkeletonReview(id, user) }); }
  catch (error) { return errorResponse(error, 400); }
}
export async function PATCH(request: Request, context: Context) {
  try {
    const user = await requireSessionUser(request); const id = z.string().uuid().parse((await context.params).reviewId); const input = await request.json();
    const review = await withDatabaseTransaction(async () => {
      const saved = await decideSkeletonReview(id, input, user);
      await recordAuditLog({ actor: user, action: 'skeleton.judgment_recorded', targetType: 'project', targetId: saved.projectId, summary: 'Human Skeleton Lock judgment recorded.', metadata: { reviewId: id, revision: saved.revision } });
      return saved;
    });
    return NextResponse.json({ review });
  } catch (error) { return errorResponse(error, 400); }
}
