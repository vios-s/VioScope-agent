import 'dotenv/config';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { AuthError, requireSessionUser } from '../../../../../src/mastra/auth/session';
import { errorResponse } from '../../../../../src/mastra/http/error-response';
import { getIdeaCheck, saveIdeaReview } from '../../../../../src/mastra/db/idea-checks';
import { reviewIdeaPitch } from '../../../../../src/mastra/projects/idea-review';
import { recordAuditLog } from '../../../../../src/mastra/db/audit-log';
import { withDatabaseTransaction } from '../../../../../src/mastra/db/postgres';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request, context: { params: Promise<{ pitchId: string }> }) {
  try {
    const actor = await requireSessionUser(request);
    const { pitchId } = await context.params;
    z.string().uuid().parse(pitchId);
    const { version } = z.object({ version: z.number().int().positive() }).strict().parse(await request.json());
    const state = await getIdeaCheck(pitchId, actor);
    if (!state.canEdit || !state.current || state.current.version !== version) throw new AuthError('Save the current draft before requesting a review.', 409, 'conflict');
    const review = await reviewIdeaPitch(state.pitch.title, state.current.draft);
    const saved = await withDatabaseTransaction(async () => {
      const result = await saveIdeaReview(pitchId, version, review, actor);
      await recordAuditLog({ actor, action: 'idea_pitch.review', targetType: 'idea_pitch', targetId: pitchId,
        summary: 'User requested an advisory idea pitch review.', metadata: { reviewId: result.id, version, rulesHash: review.rulesHash, model: review.model } });
      return result;
    });
    return NextResponse.json(saved);
  } catch (error) { return errorResponse(error, 400); }
}
