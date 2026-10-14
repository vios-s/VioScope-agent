import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { NextResponse } from 'next/server';
import { requireSessionUser } from '../../../../../src/mastra/auth/session';
import { errorResponse } from '../../../../../src/mastra/http/error-response';
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
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.webp') return 'image/webp';
  if (['.md', '.markdown', '.txt', '.tex', '.rst', '.csv', '.json', '.yaml', '.yml'].includes(ext)) return 'text/plain; charset=utf-8';
  return 'application/octet-stream';
}

export async function GET(request: Request, context: { params: Promise<{ artifactId: string }> }) {
  try {
    const actor = await requireSessionUser(request);
    const { artifactId } = await context.params;
    const { project, artifact } = await getProjectArtifactForUser(artifactId, actor);
    const storedPath = await assertStoredProjectArtifactPath(artifact.path, project);

    const buffer = await readFile(/* turbopackIgnore: true */ storedPath);
    const fileName = artifact.title || basename(storedPath);
    const inline = new URL(request.url).searchParams.get('inline') === '1';
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
        'content-disposition': `${inline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(fileName)}"`,
      },
    });
  } catch (error) {
    return errorResponse(error, 404);
  }
}
