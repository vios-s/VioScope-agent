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

function integer(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new Error('Expected an integer value.');
  }
  return parsed;
}

function booleanValue(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value === 'true' || value === 'on' || value === '1';
  return Boolean(value);
}

function updateInput(body: Record<string, unknown>): AddProjectUpdateInput {
  const artifact = body.artifact && typeof body.artifact === 'object' ? (body.artifact as Record<string, unknown>) : null;
  return {
    date: optionalText(body.date),
    type: text(body.type) as AddProjectUpdateInput['type'],
    text: text(body.text) || '',
    stage: integer(body.stage),
    stageProgress: integer(body.stageProgress),
    status: text(body.status) as AddProjectUpdateInput['status'],
    blocker: optionalText(body.blocker),
    target: optionalText(body.target),
    milestone: booleanValue(body.milestone),
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
      stage: integer(formText(formData, 'stage')),
      stageProgress: integer(formText(formData, 'stageProgress')),
      status: formText(formData, 'status') as AddProjectUpdateInput['status'],
      blocker: optionalText(formText(formData, 'blocker')),
      target: optionalText(formText(formData, 'target')),
      milestone: booleanValue(formText(formData, 'milestone')),
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
        stage: input.stage ?? null,
        stageProgress: input.stageProgress ?? null,
        status: input.status || null,
        hasBlocker: Boolean(input.blocker),
        hasTarget: Boolean(input.target),
        milestone: Boolean(input.milestone),
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
