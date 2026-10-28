import 'dotenv/config';
import { z } from 'zod';
import { getProjectForUser } from '../../../../src/mastra/db/projects';
import { meetingProjectContext } from '../../../../src/mastra/theme-meetings/project-context';
import { NextResponse } from 'next/server';
import { AuthError, canSeeAll, isUserName, requireSessionUser } from '../../../../src/mastra/auth/session';
import { errorResponse } from '../../../../src/mastra/http/error-response';
import { recordAuditLog } from '../../../../src/mastra/db/audit-log';
import { submitThemeMeetingUpdate } from '../../../../src/mastra/theme-meetings/planner';
import { themeUpdateTypeSchema } from '../../../../src/mastra/theme-meetings/schema';

export const runtime = 'nodejs';

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export async function POST(request: Request) {
  try {
    const user = await requireSessionUser(request);
    const body = (await request.json()) as Record<string, unknown>;
    const themeId = text(body.themeId);
    const member = text(body.member);
    const progressText = text(body.progressText);
    const parsedUpdateType = themeUpdateTypeSchema.safeParse(body.updateType);

    if (!themeId) throw new Error('Choose a theme before submitting.');
    if (!member) throw new Error('Choose a member before submitting.');
    if (!parsedUpdateType.success) throw new Error('Choose a valid slot type before submitting.');
    if (!progressText && parsedUpdateType.data !== 'nothing_to_report') {
      throw new Error('Add a short progress update before submitting.');
    }

    if (!canSeeAll(user) && !isUserName(member, user)) {
      throw new AuthError('Members can only submit their own update.', 403, 'forbidden');
    }

    let projectContext;
    if (body.projectId !== undefined && body.projectId !== null) {
      const projectId = z.string().uuid().parse(body.projectId);
      const project = await getProjectForUser(projectId, user);
      if (project.ownerUsername !== member.trim().toLowerCase()) {
        throw new AuthError('Only the project owner can attach this project to their meeting update.', 403, 'forbidden');
      }
      if (project.lifecycle !== 'active') throw new Error('Only active projects can be linked to a meeting update.');
      projectContext = meetingProjectContext(project);
    }
    const result = await submitThemeMeetingUpdate({
      projectContext,
      meetingDate: text(body.meetingDate),
      themeId,
      member,
      updateType: parsedUpdateType.data,
      progressText,
      questions: text(body.questions),
      submittedVia: 'dashboard',
      validateUsers: true,
    });

    await recordAuditLog({
      actor: user,
      action: 'theme_meeting.update_submit',
      targetType: 'theme_meeting',
      targetId: themeId,
      summary: 'Theme meeting update submitted.',
      metadata: {
        meetingDate: text(body.meetingDate) || null,
        member,
        updateType: parsedUpdateType.data,
        progressLength: progressText?.length || 0,
        hasQuestions: Boolean(text(body.questions)),
      },
    });
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error, 400);
  }
}
