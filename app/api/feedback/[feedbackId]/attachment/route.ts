import 'dotenv/config';
import { NextResponse } from 'next/server';
import { requireSessionUser } from '../../../../../src/mastra/auth/session';
import { errorResponse } from '../../../../../src/mastra/http/error-response';
import { getFeedbackAttachmentForUser } from '../../../../../src/mastra/db/feedback';
import { readFeedbackAttachment } from '../../../../../src/mastra/feedback/attachments';

export const runtime = 'nodejs';

export async function GET(request: Request, context: { params: Promise<{ feedbackId: string }> }) {
  try {
    const user = await requireSessionUser(request);
    const { feedbackId } = await context.params;
    const attachment = await getFeedbackAttachmentForUser(feedbackId, user);
    const body = await readFeedbackAttachment(attachment.path);
    return new NextResponse(new Uint8Array(body), {
      headers: {
        'Content-Type': attachment.mimeType,
        'Content-Length': String(body.byteLength),
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(attachment.name)}`,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    return errorResponse(error, 404);
  }
}
