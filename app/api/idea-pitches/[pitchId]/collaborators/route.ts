import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireSessionUser } from '../../../../../src/mastra/auth/session';
import { changeIdeaCollaborator } from '../../../../../src/mastra/db/idea-checks';
import { recordAuditLog } from '../../../../../src/mastra/db/audit-log';
import { withDatabaseTransaction } from '../../../../../src/mastra/db/postgres';
import { errorResponse } from '../../../../../src/mastra/http/error-response';
export const runtime = 'nodejs';
export async function POST(request: Request, context: { params: Promise<{ pitchId: string }> }) {
  try {
    const actor = await requireSessionUser(request);
    const { pitchId } = await context.params;
    z.string().uuid().parse(pitchId);
    const command = z.object({ username: z.string().trim().toLowerCase().min(1).max(100), action: z.enum(['add', 'remove']) }).strict().parse(await request.json());
    const result = await withDatabaseTransaction(async () => {
      const changed = await changeIdeaCollaborator(pitchId, command.username, command.action, actor);
      await recordAuditLog({ actor, action: `idea_pitch.collaborator_${command.action}`, targetType: 'idea_pitch', targetId: pitchId, summary: 'User changed read-only pitch sharing.', metadata: changed });
      return changed;
    });
    return NextResponse.json(result);
  } catch (error) { return errorResponse(error, 400); }
}
