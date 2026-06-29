import 'dotenv/config';
import { NextResponse } from 'next/server';
import { AuthError, canSeeAll, requireSessionUser } from '../../../src/mastra/auth/session';
import { recordAuditLog } from '../../../src/mastra/db/audit-log';
import { ensureUsersTable, upsertPublicTeamProfiles } from '../../../src/mastra/db/users';
import { parsePublicTeamProfilesMarkdown } from '../../../src/mastra/team/public-profiles';
import { readTeamProfileMarkdown, writeTeamProfileMarkdown } from '../../../src/mastra/team/profile-markdown-store';

export const runtime = 'nodejs';

async function requireTeamProfileEditor(request: Request) {
  const user = await requireSessionUser(request);
  if (!canSeeAll(user)) {
    throw new AuthError('PI or administrator permission is required.', 403, 'forbidden');
  }
  return user;
}

function errorResponse(error: unknown, status = 500) {
  return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
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
    return errorResponse(error, error instanceof AuthError ? error.status : 500);
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

    const result = await writeTeamProfileMarkdown(body.markdown);
    let importedCount: number | undefined;
    if (shouldImport) {
      await ensureUsersTable();
      const records = await upsertPublicTeamProfiles(profiles, { sourceUrl: sourceUrlFromMarkdown(result.markdown) });
      importedCount = records.length;
    }

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
    return errorResponse(error, error instanceof AuthError ? error.status : 400);
  }
}
