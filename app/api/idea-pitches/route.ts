import 'dotenv/config';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { canSeeAll, requireSessionUser } from '../../../src/mastra/auth/session';
import { errorResponse } from '../../../src/mastra/http/error-response';
import { createIdeaPitch, listIdeaPitches } from '../../../src/mastra/db/idea-checks';
import { recordAuditLog } from '../../../src/mastra/db/audit-log';
import { withDatabaseTransaction } from '../../../src/mastra/db/postgres';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try { const actor = await requireSessionUser(request); return NextResponse.json({ pitches: await listIdeaPitches(actor), scope: canSeeAll(actor) ? 'all' : 'personal', username: actor.username }); }
  catch (error) { return errorResponse(error, 400); }
}
export async function POST(request: Request) {
  try {
    const actor = await requireSessionUser(request);
    const { title } = z.object({ title: z.string().trim().min(1).max(200) }).strict().parse(await request.json());
    const result = await withDatabaseTransaction(async () => {
      const pitch = await createIdeaPitch(title, actor);
      await recordAuditLog({ actor, action: 'idea_pitch.create', targetType: 'idea_pitch', targetId: pitch.id, summary: 'User created an idea pitch.' });
      return pitch;
    });
    return NextResponse.json(result);
  } catch (error) { return errorResponse(error, 400); }
}
