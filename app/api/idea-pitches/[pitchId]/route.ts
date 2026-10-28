import 'dotenv/config';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireSessionUser } from '../../../../src/mastra/auth/session';
import { errorResponse } from '../../../../src/mastra/http/error-response';
import { getIdeaCheck, writeIdeaCheck, createProjectFromPitch, deleteIdeaPitch } from '../../../../src/mastra/db/idea-checks';
import { ideaCommandSchema, initialProjectActionSchema } from '../../../../src/mastra/projects/idea-check';
import { recordAuditLog } from '../../../../src/mastra/db/audit-log';
import { withDatabaseTransaction } from '../../../../src/mastra/db/postgres';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const commandSchema = z.union([ideaCommandSchema, z.object({ operation: z.literal('create_project'), version: z.number().int().positive(), confirmed: z.literal(true), initialAction: initialProjectActionSchema.optional() }).strict()]);
export async function GET(request: Request, context: { params: Promise<{ pitchId: string }> }) {
  try {
    const user = await requireSessionUser(request);
    const { pitchId } = await context.params;
    return NextResponse.json(await getIdeaCheck(z.string().uuid().parse(pitchId), user));
  } catch (error) { return errorResponse(error, 400); }
}
export async function POST(request: Request, context: { params: Promise<{ pitchId: string }> }) {
  try {
    const actor = await requireSessionUser(request);
    const { pitchId } = await context.params;
    z.string().uuid().parse(pitchId);
    const command = commandSchema.parse(await request.json());
    const result = await withDatabaseTransaction(async () => {
      const saved = command.operation === 'create_project' ? await createProjectFromPitch(pitchId, command.version, actor, command.initialAction) : await writeIdeaCheck(pitchId, command, actor);
      await recordAuditLog({ actor, action: `idea_pitch.${command.operation}`, targetType: 'idea_pitch', targetId: pitchId,
        summary: 'User updated an idea pitch.', metadata: { ...saved, operation: command.operation } });
      return saved;
    });
    return NextResponse.json(result);
  } catch (error) { return errorResponse(error, 400); }
}

export async function DELETE(request: Request, context: { params: Promise<{ pitchId: string }> }) {
  try {
    const actor = await requireSessionUser(request);
    const { pitchId } = await context.params;
    z.string().uuid().parse(pitchId);
    const command = z.object({ version: z.number().int().min(0), confirmed: z.literal(true) }).strict().parse(await request.json());
    const result = await withDatabaseTransaction(async () => {
      const deleted = await deleteIdeaPitch(pitchId, command.version, actor);
      await recordAuditLog({ actor, action: 'idea_pitch.delete', targetType: 'idea_pitch', targetId: pitchId,
        summary: 'User deleted an idea pitch and its private versions and reviews.' });
      return deleted;
    });
    return NextResponse.json(result);
  } catch (error) { return errorResponse(error, 400); }
}
