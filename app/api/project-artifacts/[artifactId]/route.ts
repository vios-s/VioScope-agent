import 'dotenv/config';
import { NextResponse } from 'next/server';
import { requireSessionUser } from '../../../../src/mastra/auth/session';
import { errorResponse } from '../../../../src/mastra/http/error-response';
import { recordAuditLog } from '../../../../src/mastra/db/audit-log';
import { getProjectArtifactForUser, removeProjectArtifact } from '../../../../src/mastra/db/projects';

export const runtime = 'nodejs';

export async function DELETE(request: Request, context: { params: Promise<{ artifactId: string }> }) {
  try {
    const actor = await requireSessionUser(request);
    const { artifactId } = await context.params;
    const { project, artifact } = await getProjectArtifactForUser(artifactId, actor);
    const nextProject = await removeProjectArtifact(artifactId, actor);

    await recordAuditLog({
      actor,
      action: 'project.artifact_remove',
      targetType: 'project_artifact',
      targetId: artifact.id,
      summary: 'User removed project artifact.',
      metadata: {
        projectId: project.id,
        slug: project.project,
        artifactKind: artifact.kind,
        fileName: artifact.title,
        wasCurrent: artifact.isCurrent,
      },
    });

    return NextResponse.json({ project: nextProject });
  } catch (error) {
    return errorResponse(error, 400);
  }
}
