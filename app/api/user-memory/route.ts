import 'dotenv/config';
import { NextResponse } from 'next/server';
import { join } from 'node:path';
import { AuthError, requireSessionUser } from '../../../src/mastra/auth/session';
import { withFileLock } from '../../../src/mastra/atomic-file';
import { errorResponse } from '../../../src/mastra/http/error-response';
import { recordAuditLog } from '../../../src/mastra/db/audit-log';
import { readOwnUserMemory, userDatastoreRoot, writeOwnUserMemory } from '../../../src/mastra/users/datastore';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const user = await requireSessionUser(request);
    return NextResponse.json(await readOwnUserMemory(user));
  } catch (error) {
    return errorResponse(error, 500);
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireSessionUser(request);
    const body = (await request.json()) as Record<string, unknown>;
    if (typeof body.markdown !== 'string') {
      throw new Error('markdown is required.');
    }

    const markdown = body.markdown;
    const baseRevision = typeof body.baseRevision === 'string' ? body.baseRevision : undefined;
    const root = userDatastoreRoot(user);
    if (!root) throw new Error('DATASTORE_DIR is required for user memory.');
    // A stale tab or device that sends the revision it loaded gets a conflict instead of overwriting newer notes.
    const result = await withFileLock(join(root, 'memory.md'), async () => {
      if (baseRevision && baseRevision !== (await readOwnUserMemory(user)).revision) {
        throw new AuthError('Your memory changed in another tab or device. Load the latest version before saving.', 409, 'conflict');
      }
      return writeOwnUserMemory(user, markdown);
    });
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
    return errorResponse(error, 400);
  }
}
