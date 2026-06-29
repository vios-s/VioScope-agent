import 'dotenv/config';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { listUsersForAdmin, type AuthUser } from '../src/mastra/db/users';
import { defaultUserMemoryMarkdown, userDatastoreRoot, userDatastoreSlug } from '../src/mastra/users/datastore';

const teamRawRoot = 'https://raw.githubusercontent.com/vios-s/vios.science/main/src/content/team';

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function fetchPublicTeamMarkdown(user: AuthUser): Promise<{ source: string; markdown: string } | null> {
  const candidates = [
    user.sourceProfileId,
    `${userDatastoreSlug(user)}.md`,
    `${user.username}.md`,
  ].filter((value): value is string => Boolean(value));

  for (const sourceId of [...new Set(candidates)]) {
    const source = `${teamRawRoot}/${encodeURIComponent(sourceId)}`;
    const response = await fetch(source);
    if (response.ok) {
      return { source, markdown: await response.text() };
    }
  }

  return null;
}

function seededMemory(user: AuthUser, publicSource: { source: string; markdown: string } | null): string {
  const base = defaultUserMemoryMarkdown(user).trimEnd();
  if (!publicSource) return `${base}\n\n## Public site source\n\nNo matching vios.science team markdown was found.\n`;

  return `${base}

## Public site source

Source: ${publicSource.source}

${publicSource.markdown.trim()}
`;
}

async function main() {
  const users = await listUsersForAdmin();
  const results = { created: 0, skipped: 0, missingRoot: 0 };

  for (const user of users) {
    const root = userDatastoreRoot(user);
    if (!root) {
      results.missingRoot += 1;
      continue;
    }

    const path = join(root, 'memory.md');
    if (await exists(path)) {
      results.skipped += 1;
      continue;
    }

    const publicSource = await fetchPublicTeamMarkdown(user);
    await mkdir(root, { recursive: true });
    await writeFile(path, `${seededMemory(user, publicSource).trimEnd()}\n`, 'utf8');
    results.created += 1;
  }

  console.log(JSON.stringify(results, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
