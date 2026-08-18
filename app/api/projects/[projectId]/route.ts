import 'dotenv/config';
import { NextResponse } from 'next/server';
import { requireSessionUser } from '../../../../src/mastra/auth/session';
import { errorResponse } from '../../../../src/mastra/http/error-response';
import { recordAuditLog } from '../../../../src/mastra/db/audit-log';
import {
  archiveProject,
  getProjectForUser,
  updateProject,
} from '../../../../src/mastra/db/projects';
import { changedProjectFields, parseProjectInput } from '../../../../src/mastra/projects/input';

export const runtime = 'nodejs';

export async function GET(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const user = await requireSessionUser(request);
    const { projectId } = await context.params;
    return NextResponse.json({ project: await getProjectForUser(projectId, user) });
  } catch (error) {
    return errorResponse(error, 404);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const actor = await requireSessionUser(request);
    const { projectId } = await context.params;
    const body = await request.json();
    const fields = changedProjectFields(body);
    const project = await updateProject(projectId, parseProjectInput(body), actor);

    await recordAuditLog({
      actor,
      action: 'project.update',
      targetType: 'project',
      targetId: project.id,
      summary: 'User updated project.',
      metadata: {
        slug: project.project,
        changedFields: fields,
        changedFieldCount: fields.length,
        collaboratorCount: project.collaborators.length,
        track: project.track,
        stage: project.stage,
        stageProgress: project.stageProgress,
        lifecycle: project.lifecycle,
        status: project.status,
        hasNotes: Boolean(project.notes),
        hasTarget: Boolean(project.target),
        hasBlocker: Boolean(project.blocker),
      },
    });

    return NextResponse.json({ project });
  } catch (error) {
    return errorResponse(error, 400);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const actor = await requireSessionUser(request);
    const { projectId } = await context.params;
    const project = await archiveProject(projectId, actor);

    await recordAuditLog({
      actor,
      action: 'project.archive',
      targetType: 'project',
      targetId: project.id,
      summary: 'User archived project.',
      metadata: {
        slug: project.project,
        lifecycle: project.lifecycle,
        status: project.status,
      },
    });

    return NextResponse.json({ project });
  } catch (error) {
    return errorResponse(error, 400);
  }
}
