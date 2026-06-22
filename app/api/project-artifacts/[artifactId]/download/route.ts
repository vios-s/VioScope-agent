import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { NextResponse } from 'next/server';
import { AuthError, requireSessionUser } from '../../../../../src/mastra/auth/session';
import { recordAuditLog } from '../../../../../src/mastra/db/audit-log';
import { getProjectArtifactForUser } from '../../../../../src/mastra/db/projects';
import { assertStoredProjectArtifactPath } from '../../../../../src/mastra/projects/artifacts';

export const runtime = 'nodejs';

function contentType(fileName: string): string {
  const ext = extname(fileName).toLowerCase();
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (ext === '.pptx') return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  if (ext === '.zip') return 'application/zip';
  if (['.md', '.markdown', '.txt', '.tex', '.rst', '.csv', '.json', '.yaml', '.yml'].includes(ext)) return 'text/plain; charset=utf-8';
  return 'application/octet-stream';
}

function errorResponse(error: unknown, status = 500) {
  return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
}

export async function GET(request: Request, context: { params: Promise<{ artifactId: string }> }) {
  try {
    const actor = await requireSessionUser(request);
    const { artifactId } = await context.params;
    const { project, artifact } = await getProjectArtifactForUser(artifactId, actor);
    const storedPath = assertStoredProjectArtifactPath(artifact.path);

    const buffer = await readFile(storedPath);
    const fileName = artifact.title || basename(storedPath);
    await recordAuditLog({
      actor,
      action: 'project.artifact_download',
      targetType: 'project_artifact',
      targetId: artifact.id,
      summary: 'User downloaded project artifact.',
      metadata: {
        projectId: project.id,
        slug: project.project,
        artifactKind: artifact.kind,
        fileName,
      },
    });

    return new Response(buffer, {
      headers: {
        'content-type': contentType(fileName),
        'content-disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
      },
    });
  } catch (error) {
    return errorResponse(error, error instanceof AuthError ? error.status : 404);
  }
}
