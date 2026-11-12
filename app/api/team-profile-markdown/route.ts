import 'dotenv/config';
import { NextResponse } from 'next/server';
import { AuthError, canSeeAll, requireSessionUser } from '../../../src/mastra/auth/session';
import { errorResponse } from '../../../src/mastra/http/error-response';
import { recordAuditLog } from '../../../src/mastra/db/audit-log';
import { ensureUsersTable, upsertPublicTeamProfiles } from '../../../src/mastra/db/users';
import { parsePublicTeamProfilesMarkdown } from '../../../src/mastra/team/public-profiles';
import { readTeamProfileMarkdown, teamProfileMarkdownPath, writeTeamProfileMarkdown } from '../../../src/mastra/team/profile-markdown-store';
import { withFileLock } from '../../../src/mastra/atomic-file';

export const runtime = 'nodejs';

async function requireTeamProfileEditor(request: Request) {
  const user = await requireSessionUser(request);
  if (!canSeeAll(user)) {
    throw new AuthError('PI or administrator permission is required.', 403, 'forbidden');
  }
  return user;
}

function sourceUrlFromMarkdown(markdown: string): string {
  const match = markdown.match(/^Source:\s*(.+)$/m);
  return match?.[1]?.trim() || 'https://vios.science/team/';
}

export async function GET(request: Request) {
  try {
    await requireTeamProfileEditor(request);
    return NextResponse.json(await readTeamProfileMarkdown());
  } catch (error) {
    return errorResponse(error, 500);
  }
}

export async function PATCH(request: Request) {
  try {
    const actor = await requireTeamProfileEditor(request);
    const body = (await request.json()) as Record<string, unknown>;
    if (typeof body.markdown !== 'string') {
      throw new Error('markdown is required.');
    }

    const shouldImport = body.importProfiles === true;
    const profiles = shouldImport ? parsePublicTeamProfilesMarkdown(body.markdown) : [];
    if (shouldImport && !profiles.length) {
      throw new Error('No public team profiles parsed from markdown.');
    }

    const markdown = body.markdown;
    const baseRevision = typeof body.baseRevision === 'string' ? body.baseRevision : undefined;
    await ensureUsersTable();
    // Compare, import and replace under one lock and transaction: a stale editor gets a conflict, and a failed
    // import or write leaves both the accounts and the file unchanged.
    const { result, importedCount } = await withFileLock(teamProfileMarkdownPath(), async () => {
      if (baseRevision && baseRevision !== (await readTeamProfileMarkdown()).revision) {
        throw new AuthError('The team profiles changed while you were editing. Load the latest version before saving.', 409, 'conflict');
      }
      const records = shouldImport ? await upsertPublicTeamProfiles(profiles, { sourceUrl: sourceUrlFromMarkdown(markdown) }) : undefined;
      return { result: await writeTeamProfileMarkdown(markdown), importedCount: records?.length };
    });

    await recordAuditLog({
      actor,
      action: shouldImport ? 'team_profile_markdown.save_import' : 'team_profile_markdown.update',
      targetType: 'team_profile_markdown',
      targetId: result.path,
      summary:
        shouldImport
          ? 'User saved and imported the public team profile markdown cache.'
          : 'User updated the public team profile markdown cache.',
      metadata: { path: result.path, markdownLength: result.markdown.length, importedCount },
    });
    return NextResponse.json({ ...result, importedCount });
  } catch (error) {
    return errorResponse(error, 400);
  }
}
