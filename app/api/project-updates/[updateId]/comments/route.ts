import 'dotenv/config';
import { NextResponse } from 'next/server';
import { requireSessionUser } from '../../../../../src/mastra/auth/session';
import { errorResponse } from '../../../../../src/mastra/http/error-response';
import { recordAuditLog } from '../../../../../src/mastra/db/audit-log';
import { addProjectUpdateComment, changeProjectUpdateComment, listOwnCommentHistory } from '../../../../../src/mastra/db/projects';

export const runtime = 'nodejs';

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export async function GET(request: Request, context: { params: Promise<{ updateId: string }> }) {
  try {
    const actor = await requireSessionUser(request);
    const { updateId } = await context.params;
    return NextResponse.json({ comments: await listOwnCommentHistory(updateId, actor) });
  } catch (error) { return errorResponse(error, 400); }
}

export async function POST(request: Request, context: { params: Promise<{ updateId: string }> }) {
  try {
    const actor = await requireSessionUser(request);
    const { updateId } = await context.params;
    const body = (await request.json()) as Record<string, unknown>;
    const commentText = text(body.text) || '';
    const project = await addProjectUpdateComment(updateId, commentText, actor);

    await recordAuditLog({
      actor,
      action: 'project.update_comment',
      targetType: 'project_update',
      targetId: updateId,
      summary: 'User commented on project timeline update.',
      metadata: {
        projectId: project.id,
        slug: project.project,
        textLength: commentText.length,
      },
    });

    return NextResponse.json({ project });
  } catch (error) {
    return errorResponse(error, 400);
  }
}

async function change(request: Request, context: { params: Promise<{ updateId: string }> }, remove: boolean) {
  try {
    const actor = await requireSessionUser(request);
    const { updateId } = await context.params;
    const body = await request.json() as Record<string, unknown>;
    const id = text(body.id) || '';
    const expectedText = text(body.expectedText) || '';
    const nextText = remove ? null : text(body.text) || '';
    const project = await changeProjectUpdateComment(updateId, id, expectedText, nextText, actor);
    await recordAuditLog({ actor, action: remove ? 'project.comment_remove' : 'project.comment_edit', targetType: 'project_update', targetId: updateId, summary: remove ? 'Comment removed.' : 'Comment edited.', metadata: { projectId: project.id, commentId: id } });
    return NextResponse.json({ project });
  } catch (error) { return errorResponse(error, 400); }
}
export const PATCH = (request: Request, context: { params: Promise<{ updateId: string }> }) => change(request, context, false);
export const DELETE = (request: Request, context: { params: Promise<{ updateId: string }> }) => change(request, context, true);
