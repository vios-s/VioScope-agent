import 'dotenv/config';
import { NextResponse } from 'next/server';
import { requireSessionUser } from '../../../../src/mastra/auth/session';
import { errorResponse } from '../../../../src/mastra/http/error-response';
import { recordAuditLog } from '../../../../src/mastra/db/audit-log';
import { deleteProjectUpdate, editProjectUpdate, getProjectForUpdate, getProjectForUser, type AddProjectUpdateInput } from '../../../../src/mastra/db/projects';
import { saveProjectArtifactUpload, type ProjectArtifactUploadDigest } from '../../../../src/mastra/projects/artifacts';

export const runtime = 'nodejs';
export const maxDuration = 180;

function text(value: FormDataEntryValue | null): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function integer(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error('Expected an integer value.');
  return parsed;
}

async function inputFromRequest(request: Request, projectId: string, actor: Awaited<ReturnType<typeof requireSessionUser>>) {
  if ((request.headers.get('content-type') || '').includes('application/json')) {
    const body = (await request.json()) as Record<string, unknown>;
    const string = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : undefined);
    return {
      input: {
        date: string(body.date) || null,
        type: string(body.type) as AddProjectUpdateInput['type'],
        text: string(body.text) || '',
        stage: integer(body.stage),
        stageProgress: integer(body.stageProgress),
        status: string(body.status) as AddProjectUpdateInput['status'],
        blocker: body.blocker === null ? null : string(body.blocker) || null,
        target: body.target === null ? null : string(body.target) || null,
        milestone: Boolean(body.milestone),
        artifact: null,
      } satisfies AddProjectUpdateInput,
      uploadDigest: null,
    };
  }
  const form = await request.formData();
  const file = form.get('artifactFile');
  let uploadDigest: ProjectArtifactUploadDigest | null = null;
  if (file instanceof File && file.size > 0) {
    const project = await getProjectForUser(projectId, actor);
    if (!project.access.canEdit) throw new Error('You do not have permission to edit project updates.');
    uploadDigest = await saveProjectArtifactUpload(project, file);
  }
  const input: AddProjectUpdateInput = {
    date: text(form.get('date')) || null,
    type: text(form.get('type')) as AddProjectUpdateInput['type'],
    text: text(form.get('text')) || '',
    stage: integer(text(form.get('stage'))),
    stageProgress: integer(text(form.get('stageProgress'))),
    status: text(form.get('status')) as AddProjectUpdateInput['status'],
    blocker: text(form.get('blocker')) || null,
    target: text(form.get('target')) || null,
    milestone: text(form.get('milestone')) === 'true',
    artifact: uploadDigest?.artifact || null,
  };
  return { input, uploadDigest };
}

export async function PATCH(request: Request, context: { params: Promise<{ updateId: string }> }) {
  try {
    const actor = await requireSessionUser(request);
    const { updateId } = await context.params;
    const projectId = (await getProjectForUpdate(updateId, actor)).id;
    const { input, uploadDigest } = await inputFromRequest(request, projectId, actor);
    const project = await editProjectUpdate(updateId, input, actor);
    await recordAuditLog({ actor, action: 'project.update_edit', targetType: 'project_update', targetId: updateId, summary: 'User edited project timeline update.', metadata: { projectId: project.id, slug: project.project, hasArtifact: Boolean(uploadDigest), textLength: input.text.length } });
    return NextResponse.json({ project });
  } catch (error) {
    return errorResponse(error, 400);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ updateId: string }> }) {
  try {
    const actor = await requireSessionUser(request);
    const { updateId } = await context.params;
    const project = await deleteProjectUpdate(updateId, actor);
    await recordAuditLog({ actor, action: 'project.update_remove', targetType: 'project_update', targetId: updateId, summary: 'User removed project timeline update.', metadata: { projectId: project.id, slug: project.project } });
    return NextResponse.json({ project });
  } catch (error) {
    return errorResponse(error, 400);
  }
}
