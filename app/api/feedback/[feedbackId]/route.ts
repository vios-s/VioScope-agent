import 'dotenv/config';
import { NextResponse } from 'next/server';
import { AuthError, requireAdministrator } from '../../../../src/mastra/auth/session';
import { feedbackStatuses, updateFeedbackQuery, type FeedbackStatus } from '../../../../src/mastra/db/feedback';
import { recordAuditLog } from '../../../../src/mastra/db/audit-log';

export const runtime = 'nodejs';

function errorResponse(error: unknown, status = 500) {
  return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
}

export async function PATCH(request: Request, context: { params: Promise<{ feedbackId: string }> }) {
  try {
    const admin = await requireAdministrator(request);
    const { feedbackId } = await context.params;
    const body = (await request.json()) as Record<string, unknown>;
    const status = typeof body.status === 'string' ? body.status : '';
    const adminNote = typeof body.adminNote === 'string' ? body.adminNote.trim() : '';
    if (!feedbackStatuses.includes(status as FeedbackStatus)) throw new Error('Invalid feedback status.');
    if (adminNote.length > 5_000) throw new Error('Administrator reply must be 5000 characters or fewer.');

    const query = await updateFeedbackQuery(feedbackId, { status: status as FeedbackStatus, adminNote, actor: admin });
    await recordAuditLog({
      actor: admin,
      action: 'feedback.update',
      targetType: 'feedback_query',
      targetId: query.id,
      summary: 'Administrator updated feedback status or reply.',
      metadata: { status: query.status, adminNoteLength: query.adminNote.length },
    });
    return NextResponse.json({ query });
  } catch (error) {
    return errorResponse(error, error instanceof AuthError ? error.status : 400);
  }
}
