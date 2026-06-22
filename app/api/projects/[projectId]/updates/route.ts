import 'dotenv/config';
import { NextResponse } from 'next/server';
import { AuthError, requireSessionUser } from '../../../../../src/mastra/auth/session';
import { recordAuditLog } from '../../../../../src/mastra/db/audit-log';
import { addProjectUpdate, getProjectForUser, type AddProjectUpdateInput } from '../../../../../src/mastra/db/projects';
import { saveProjectArtifactUpload, type ProjectArtifactUploadDigest } from '../../../../../src/mastra/projects/artifacts';

export const runtime = 'nodejs';
export const maxDuration = 180;

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function optionalText(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') {
    throw new Error('Expected text value.');
  }
  return value.trim() || null;
}

function updateInput(body: Record<string, unknown>): AddProjectUpdateInput {
  const artifact = body.artifact && typeof body.artifact === 'object' ? (body.artifact as Record<string, unknown>) : null;
  return {
    date: optionalText(body.date),
    type: text(body.type) as AddProjectUpdateInput['type'],
    text: text(body.text) || '',
    artifact: artifact
      ? {
          title: text(artifact.title),
          kind: text(artifact.kind),
          path: text(artifact.path),
          summary: text(artifact.summary),
          artifactKey: text(artifact.artifactKey),
        }
      : null,
  };
}

function formText(formData: FormData, key: string): string | undefined {
  const value = formData.get(key);
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

async function updateInputFromForm(
  formData: FormData,
  projectId: string,
  actor: Awaited<ReturnType<typeof requireSessionUser>>,
): Promise<{ input: AddProjectUpdateInput; uploadDigest: ProjectArtifactUploadDigest | null }> {
  const uploaded = formData.get('artifactFile');
  let uploadDigest: ProjectArtifactUploadDigest | null = null;

  if (uploaded instanceof File && uploaded.size > 0) {
    const project = await getProjectForUser(projectId, actor);
    if (!project.access.canAddUpdate) {
      throw new Error('You do not have permission to add project updates.');
    }
    uploadDigest = await saveProjectArtifactUpload(project, uploaded);
  }

  return {
    input: {
      date: formText(formData, 'date') || null,
      type: formText(formData, 'type') as AddProjectUpdateInput['type'],
      text: formText(formData, 'text') || (uploadDigest?.artifact.title ? `Uploaded ${uploadDigest.artifact.title}.` : ''),
      artifact: uploadDigest?.artifact || null,
    },
    uploadDigest,
  };
}

function errorResponse(error: unknown, status = 500) {
  return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
}

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const actor = await requireSessionUser(request);
    const { projectId } = await context.params;
    const contentType = request.headers.get('content-type') || '';
    const { input, uploadDigest } = contentType.includes('multipart/form-data')
      ? await updateInputFromForm(await request.formData(), projectId, actor)
      : { input: updateInput((await request.json()) as Record<string, unknown>), uploadDigest: null };
    const project = await addProjectUpdate(projectId, input, actor);

    await recordAuditLog({
      actor,
      action: 'project.update_add',
      targetType: 'project',
      targetId: project.id,
      summary: 'User added project timeline update.',
      metadata: {
        slug: project.project,
        updateType: input.type || 'progress',
        textLength: input.text.length,
        hasArtifact: Boolean(input.artifact?.title || input.artifact?.path),
        artifactKind: input.artifact?.kind || null,
        artifactSummaryLength: input.artifact?.summary?.length || 0,
        artifactDigestSource: uploadDigest?.digestSource || null,
        artifactExtractedChars: uploadDigest?.extractedChars || 0,
        artifactExtractedFileCount: uploadDigest?.extractedFiles.length || 0,
      },
    });

    return NextResponse.json({
      project,
      artifactDigest: uploadDigest
        ? {
            source: uploadDigest.digestSource,
            extractedChars: uploadDigest.extractedChars,
            extractedFileCount: uploadDigest.extractedFiles.length,
            summaryLength: uploadDigest.artifact.summary?.length || 0,
          }
        : null,
    });
  } catch (error) {
    return errorResponse(error, error instanceof AuthError ? error.status : 400);
  }
}
