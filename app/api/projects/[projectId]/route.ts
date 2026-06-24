import 'dotenv/config';
import { NextResponse } from 'next/server';
import { AuthError, requireSessionUser } from '../../../../src/mastra/auth/session';
import { recordAuditLog } from '../../../../src/mastra/db/audit-log';
import {
  archiveProject,
  getProjectForUser,
  updateProject,
  type ProjectUpdateInput,
} from '../../../../src/mastra/db/projects';

export const runtime = 'nodejs';

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

function textArray(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (!Array.isArray(value)) {
    throw new Error('Expected a list of usernames.');
  }
  return value.map((item) => text(item)).filter((item): item is string => Boolean(item));
}

function integer(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new Error('Expected an integer value.');
  }
  return parsed;
}

function projectInput(body: Record<string, unknown>): ProjectUpdateInput {
  return {
    title: text(body.title),
    ownerUsername: text(body.ownerUsername),
    collaborators: textArray(body.collaborators),
    track: text(body.track),
    stage: integer(body.stage),
    stageProgress: integer(body.stageProgress),
    lifecycle: text(body.lifecycle) as ProjectUpdateInput['lifecycle'],
    status: text(body.status) as ProjectUpdateInput['status'],
    stageSince: optionalText(body.stageSince),
    lastUpdate: optionalText(body.lastUpdate),
    blocker: optionalText(body.blocker),
    target: optionalText(body.target),
    venue: optionalText(body.venue),
    submissionDeadline: optionalText(body.submissionDeadline),
    watchPath: optionalText(body.watchPath),
    notes: optionalText(body.notes),
  };
}

function changedFields(body: Record<string, unknown>): string[] {
  return [
    'title',
    'ownerUsername',
    'collaborators',
    'track',
    'stage',
    'stageProgress',
    'lifecycle',
    'status',
    'stageSince',
    'lastUpdate',
    'blocker',
    'target',
    'venue',
    'submissionDeadline',
    'watchPath',
    'notes',
  ].filter((field) => body[field] !== undefined);
}

function errorResponse(error: unknown, status = 500) {
  return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
}

export async function GET(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const user = await requireSessionUser(request);
    const { projectId } = await context.params;
    return NextResponse.json({ project: await getProjectForUser(projectId, user) });
  } catch (error) {
    return errorResponse(error, error instanceof AuthError ? error.status : 404);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const actor = await requireSessionUser(request);
    const { projectId } = await context.params;
    const body = (await request.json()) as Record<string, unknown>;
    const fields = changedFields(body);
    const project = await updateProject(projectId, projectInput(body), actor);

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
    return errorResponse(error, error instanceof AuthError ? error.status : 400);
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
    return errorResponse(error, error instanceof AuthError ? error.status : 400);
  }
}
