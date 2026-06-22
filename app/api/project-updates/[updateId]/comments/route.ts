import 'dotenv/config';
import { NextResponse } from 'next/server';
import { AuthError, requireSessionUser } from '../../../../../src/mastra/auth/session';
import { recordAuditLog } from '../../../../../src/mastra/db/audit-log';
import { addProjectUpdateComment } from '../../../../../src/mastra/db/projects';

export const runtime = 'nodejs';

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function errorResponse(error: unknown, status = 500) {
  return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
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
    return errorResponse(error, error instanceof AuthError ? error.status : 400);
  }
}
