import 'dotenv/config';
import { NextResponse } from 'next/server';
import { AuthError, requireSessionUser } from '../../../../../src/mastra/auth/session';
import { recordAuditLog } from '../../../../../src/mastra/db/audit-log';
import { getProjectArtifactForUser, updateProjectArtifactDigest } from '../../../../../src/mastra/db/projects';
import { digestStoredProjectArtifact } from '../../../../../src/mastra/projects/artifacts';

export const runtime = 'nodejs';
export const maxDuration = 180;

function errorResponse(error: unknown, status = 500) {
  return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
}

export async function POST(request: Request, context: { params: Promise<{ artifactId: string }> }) {
  try {
    const actor = await requireSessionUser(request);
    const { artifactId } = await context.params;
    const { project, artifact } = await getProjectArtifactForUser(artifactId, actor);
    if (!project.access.canEdit) {
      throw new Error('You do not have permission to update this artifact.');
    }

    const digest = await digestStoredProjectArtifact(artifact);
    const nextProject = await updateProjectArtifactDigest(
      artifact.id,
      digest.artifact.summary || '',
      digest.artifact.kind || artifact.kind,
      actor,
    );

    await recordAuditLog({
      actor,
      action: 'project.artifact_digest',
      targetType: 'project_artifact',
      targetId: artifact.id,
      summary: 'User regenerated project artifact digest.',
      metadata: {
        projectId: project.id,
        slug: project.project,
        artifactKind: digest.artifact.kind || artifact.kind,
        fileName: artifact.title,
        digestSource: digest.digestSource,
        extractedChars: digest.extractedChars,
        extractedFileCount: digest.extractedFiles.length,
        summaryLength: digest.artifact.summary?.length || 0,
      },
    });

    return NextResponse.json({
      project: nextProject,
      artifactDigest: {
        source: digest.digestSource,
        extractedChars: digest.extractedChars,
        extractedFileCount: digest.extractedFiles.length,
        summaryLength: digest.artifact.summary?.length || 0,
      },
    });
  } catch (error) {
    return errorResponse(error, error instanceof AuthError ? error.status : 400);
  }
}
