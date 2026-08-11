import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { AuthError, requireSessionUser } from '../../../src/mastra/auth/session';
import { createFeedbackQuery, listFeedbackQueries } from '../../../src/mastra/db/feedback';
import { recordAuditLog } from '../../../src/mastra/db/audit-log';
import { saveFeedbackAttachment, validateFeedbackAttachment } from '../../../src/mastra/feedback/attachments';
import { notifyFeedbackAdmins } from '../../../src/mastra/feedback/notifications';

export const runtime = 'nodejs';

function formText(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

function assertText(value: string, label: string, maximum: number): string {
  if (!value) throw new Error(`${label} is required.`);
  if (value.length > maximum) throw new Error(`${label} must be ${maximum} characters or fewer.`);
  return value;
}

function errorResponse(error: unknown, status = 500) {
  return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
}

export async function GET(request: Request) {
  try {
    const user = await requireSessionUser(request);
    return NextResponse.json({
      queries: await listFeedbackQueries(user),
      canManage: user.role === 'administrator',
    });
  } catch (error) {
    return errorResponse(error, error instanceof AuthError ? error.status : 500);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireSessionUser(request);
    const form = await request.formData();
    const title = assertText(formText(form, 'title'), 'Title', 180);
    const description = assertText(formText(form, 'description'), 'Description', 10_000);
    const uploaded = form.get('attachment');
    const attachmentFile = uploaded instanceof File && uploaded.size > 0 ? uploaded : null;
    if (attachmentFile) validateFeedbackAttachment(attachmentFile);

    const id = randomUUID();
    const attachment = attachmentFile ? await saveFeedbackAttachment(id, attachmentFile) : undefined;
    const query = await createFeedbackQuery({ id, user, title, description, attachment });

    let email = { recipients: 0, delivered: 0 };
    try {
      email = await notifyFeedbackAdmins(query);
    } catch {
      await recordAuditLog({
        actor: user,
        action: 'feedback.admin_email_failed',
        targetType: 'feedback_query',
        targetId: query.id,
        summary: 'Feedback was saved but administrator email notification failed.',
      });
    }

    await recordAuditLog({
      actor: user,
      action: 'feedback.submit',
      targetType: 'feedback_query',
      targetId: query.id,
      summary: 'User submitted feedback.',
      metadata: {
        titleLength: query.title.length,
        descriptionLength: query.description.length,
        hasAttachment: Boolean(query.attachment),
        emailRecipients: email.recipients,
        emailDelivered: email.delivered,
      },
    });
    return NextResponse.json({ query, adminEmailNotified: email.delivered > 0 });
  } catch (error) {
    return errorResponse(error, error instanceof AuthError ? error.status : 400);
  }
}
