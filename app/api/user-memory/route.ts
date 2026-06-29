import 'dotenv/config';
import { NextResponse } from 'next/server';
import { AuthError, requireSessionUser } from '../../../src/mastra/auth/session';
import { recordAuditLog } from '../../../src/mastra/db/audit-log';
import { readOwnUserMemory, writeOwnUserMemory } from '../../../src/mastra/users/datastore';

export const runtime = 'nodejs';

function errorResponse(error: unknown, status = 500) {
  return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
}

export async function GET(request: Request) {
  try {
    const user = await requireSessionUser(request);
    return NextResponse.json(await readOwnUserMemory(user));
  } catch (error) {
    return errorResponse(error, error instanceof AuthError ? error.status : 500);
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireSessionUser(request);
    const body = (await request.json()) as Record<string, unknown>;
    if (typeof body.markdown !== 'string') {
      throw new Error('markdown is required.');
    }

    const result = await writeOwnUserMemory(user, body.markdown);
    const imported = body.importMemory === true;
    await recordAuditLog({
      actor: user,
      action: imported ? 'user_memory.save_import' : 'user_memory.update',
      targetType: 'user_memory',
      targetId: user.username,
      summary: imported ? 'User saved personal memory markdown for chat import.' : 'User updated personal memory markdown.',
      metadata: { slug: result.slug, path: result.path, markdownLength: result.markdown.length, imported },
    });
    return NextResponse.json({
      ...result,
      imported,
      importNote: imported ? 'Chat reads this memory file on the next message.' : undefined,
    });
  } catch (error) {
    return errorResponse(error, error instanceof AuthError ? error.status : 400);
  }
}
