import 'dotenv/config';
import { NextResponse } from 'next/server';
import { AuthError, requireSessionUser } from '../../../src/mastra/auth/session';
import { recordAuditLog } from '../../../src/mastra/db/audit-log';
import { createProject, listProjectsForUser, type ProjectCreateInput } from '../../../src/mastra/db/projects';

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

function todoArray(value: unknown): ProjectCreateInput['todos'] {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error('Expected a list of TODO items.');
  return value.map((item) => {
    if (!item || typeof item !== 'object') throw new Error('Expected a TODO item.');
    const todo = item as Record<string, unknown>;
    return {
      id: text(todo.id),
      text: text(todo.text),
      dueDate: optionalText(todo.dueDate),
      done: Boolean(todo.done),
      createdAt: text(todo.createdAt),
      updatedAt: text(todo.updatedAt),
    };
  });
}

function projectInput(body: Record<string, unknown>): ProjectCreateInput {
  return {
    project: text(body.project),
    title: text(body.title),
    ownerUsername: text(body.ownerUsername),
    collaborators: textArray(body.collaborators),
    track: text(body.track),
    stage: integer(body.stage),
    stageProgress: integer(body.stageProgress),
    lifecycle: text(body.lifecycle) as ProjectCreateInput['lifecycle'],
    status: text(body.status) as ProjectCreateInput['status'],
    stageSince: optionalText(body.stageSince),
    lastUpdate: optionalText(body.lastUpdate),
    blocker: optionalText(body.blocker),
    target: optionalText(body.target),
    venue: optionalText(body.venue),
    submissionDeadline: optionalText(body.submissionDeadline),
    watchPath: optionalText(body.watchPath),
    notes: optionalText(body.notes),
    todos: todoArray(body.todos),
  };
}

function errorResponse(error: unknown, status = 500) {
  return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
}

export async function GET(request: Request) {
  try {
    const user = await requireSessionUser(request);
    const includeArchived = new URL(request.url).searchParams.get('includeArchived') === 'true';
    return NextResponse.json({
      source: 'project_manager',
      projects: await listProjectsForUser(user, { includeArchived }),
    });
  } catch (error) {
    return errorResponse(error, error instanceof AuthError ? error.status : 500);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireSessionUser(request);
    const body = (await request.json()) as Record<string, unknown>;
    const input = projectInput(body);
    const project = await createProject(input, actor);

    await recordAuditLog({
      actor,
      action: 'project.create',
      targetType: 'project',
      targetId: project.id,
      summary: 'User created project.',
      metadata: {
        slug: project.project,
        ownerUsername: project.ownerUsername,
        collaboratorCount: project.collaborators.length,
        track: project.track,
        stage: project.stage,
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
