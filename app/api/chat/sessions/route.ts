import 'dotenv/config';
import { NextResponse } from 'next/server';
import { AuthError, requireSessionUser } from '../../../../src/mastra/auth/session';
import { recordAuditLog } from '../../../../src/mastra/db/audit-log';
import { deleteChatSessionForUser, listChatSessionsForUser, renameChatSessionForUser } from '../../../../src/mastra/db/chat';

export const runtime = 'nodejs';

function errorResponse(error: unknown, status = 500) {
  return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
}

export async function GET(request: Request) {
  try {
    const user = await requireSessionUser(request);
    return NextResponse.json({ sessions: await listChatSessionsForUser(user.id) });
  } catch (error) {
    return errorResponse(error, error instanceof AuthError ? error.status : 500);
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireSessionUser(request);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const threadId = typeof body.threadId === 'string' ? body.threadId.trim() : '';
    if (!threadId) {
      return errorResponse(new Error('threadId is required.'), 400);
    }

    const result = await deleteChatSessionForUser({ sessionId: threadId, userId: user.id });
    await recordAuditLog({
      actor: user,
      action: result === 'deleted' ? 'chat.session_deleted' : 'chat.session_removed',
      targetType: 'chat_session',
      targetId: threadId,
      summary: result === 'deleted' ? 'User deleted owned chat session.' : 'User removed shared chat session.',
      metadata: { result },
    });
    return NextResponse.json({ result });
  } catch (error) {
    const status = error instanceof AuthError ? error.status : error instanceof Error && /not found/i.test(error.message) ? 404 : 500;
    return errorResponse(error, status);
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireSessionUser(request);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const threadId = typeof body.threadId === 'string' ? body.threadId.trim() : '';
    const title = typeof body.title === 'string' ? body.title : '';
    if (!threadId) {
      return errorResponse(new Error('threadId is required.'), 400);
    }

    const session = await renameChatSessionForUser({ sessionId: threadId, userId: user.id, title });
    await recordAuditLog({
      actor: user,
      action: 'chat.session_renamed',
      targetType: 'chat_session',
      targetId: threadId,
      summary: 'User renamed owned chat session.',
      metadata: { titleLength: session.title.length },
    });
    return NextResponse.json({ session });
  } catch (error) {
    const status = error instanceof AuthError ? error.status : error instanceof Error && /owner/i.test(error.message) ? 403 : 400;
    return errorResponse(error, status);
  }
}
