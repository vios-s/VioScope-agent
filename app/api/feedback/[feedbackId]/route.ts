import 'dotenv/config';
import { NextResponse } from 'next/server';
import { requireAdministrator, requireSessionUser } from '../../../../src/mastra/auth/session';
import { errorResponse } from '../../../../src/mastra/http/error-response';
import { feedbackStatuses, updateFeedbackQuery, changeFeedbackContent, type FeedbackStatus } from '../../../../src/mastra/db/feedback';
import { recordAuditLog } from '../../../../src/mastra/db/audit-log';
import { notifyFeedbackRequester } from '../../../../src/mastra/feedback/notifications';

export const runtime = 'nodejs';

export async function PATCH(request: Request, context: { params: Promise<{ feedbackId: string }> }) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (body.operation === 'edit') return await changeContent(request, context, body, false);
    const admin = await requireAdministrator(request);
    const { feedbackId } = await context.params;
    const status = typeof body.status === 'string' ? body.status : '';
    const adminNote = typeof body.adminNote === 'string' ? body.adminNote.trim() : '';
    if (!feedbackStatuses.includes(status as FeedbackStatus)) throw new Error('Invalid feedback status.');
    if (adminNote.length > 5_000) throw new Error('Administrator reply must be 5000 characters or fewer.');

    const { query, changed } = await updateFeedbackQuery(feedbackId, { status: status as FeedbackStatus, adminNote, actor: admin });
    // The update is saved even when notification delivery fails.
    let requesterNotified: Awaited<ReturnType<typeof notifyFeedbackRequester>> = { web: false, email: false };
    let notificationFailed = false;
    try {
      requesterNotified = await notifyFeedbackRequester(query, changed, admin);
    } catch {
      notificationFailed = true;
    }
    if (notificationFailed || requesterNotified.emailFailed) {
      await recordAuditLog({
        actor: admin,
        action: 'feedback.requester_notification_failed',
        targetType: 'feedback_query',
        targetId: query.id,
        summary: notificationFailed
          ? 'Feedback was updated but the requester notification failed.'
          : 'Feedback was updated and the web notification sent, but the requester email failed.',
      });
    }
    await recordAuditLog({
      actor: admin,
      action: 'feedback.update',
      targetType: 'feedback_query',
      targetId: query.id,
      summary: 'Administrator updated feedback status or reply.',
      metadata: { status: query.status, adminNoteLength: query.adminNote.length, changed, requesterNotified },
    });
    return NextResponse.json({ query, requesterNotified });
  } catch (error) {
    return errorResponse(error, 400);
  }
}

async function changeContent(request: Request, context: { params: Promise<{ feedbackId: string }> }, body: Record<string, unknown>, remove: boolean) {
  const actor = await requireSessionUser(request);
  const { feedbackId } = await context.params;
  const expected = { title: typeof body.expectedTitle === 'string' ? body.expectedTitle : '', description: typeof body.expectedDescription === 'string' ? body.expectedDescription : '' };
  const next = remove ? null : { title: typeof body.title === 'string' ? body.title : '', description: typeof body.description === 'string' ? body.description : '' };
  const query = await changeFeedbackContent(feedbackId, actor, expected, next);
  await recordAuditLog({ actor, action: remove ? 'feedback.remove' : 'feedback.edit', targetType: 'feedback_query', targetId: feedbackId, summary: remove ? 'Feedback removed.' : 'Feedback edited.' });
  return NextResponse.json({ query });
}
export async function DELETE(request: Request, context: { params: Promise<{ feedbackId: string }> }) {
  try { return await changeContent(request, context, await request.json() as Record<string, unknown>, true); }
  catch (error) { return errorResponse(error, 400); }
}
