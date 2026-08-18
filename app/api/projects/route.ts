import 'dotenv/config';
import { NextResponse } from 'next/server';
import { requireSessionUser } from '../../../src/mastra/auth/session';
import { errorResponse } from '../../../src/mastra/http/error-response';
import { recordAuditLog } from '../../../src/mastra/db/audit-log';
import { createProject, listProjectsForUser } from '../../../src/mastra/db/projects';
import { parseProjectInput } from '../../../src/mastra/projects/input';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const user = await requireSessionUser(request);
    const includeArchived = new URL(request.url).searchParams.get('includeArchived') === 'true';
    return NextResponse.json({
      source: 'project_manager',
      projects: await listProjectsForUser(user, { includeArchived }),
    });
  } catch (error) {
    return errorResponse(error, 500);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireSessionUser(request);
    const input = parseProjectInput(await request.json());
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
    return errorResponse(error, 400);
  }
}
