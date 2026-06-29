import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, extname, join, relative, resolve } from 'node:path';
import type { AuthUser } from '../db/users';
import { runtimeEnv } from '../runtime-config';

export type UserDatastoreContext = {
  slug: string;
  root: string;
  profile?: {
    path: string;
    text: string;
  };
  memory?: {
    path: string;
    text: string;
  };
};

const maxContextChars = 6000;
const maxMemoryChars = 200_000;

function datastoreRoot(): string | undefined {
  const configured = runtimeEnv('DATASTORE_DIR').trim();
  return configured ? resolve(/* turbopackIgnore: true */ process.cwd(), configured) : undefined;
}

function storageSlug(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 64);
}

export function userDatastoreSlug(user: Pick<AuthUser, 'username' | 'sourceProfileId'>): string {
  const sourceId = user.sourceProfileId?.trim();
  const sourceSlug = sourceId ? storageSlug(basename(sourceId, extname(sourceId))) : '';
  return sourceSlug || storageSlug(user.username) || 'user';
}

export function userDatastoreRoot(user: Pick<AuthUser, 'username' | 'sourceProfileId'>): string | undefined {
  const root = datastoreRoot();
  return root ? join(root, 'users', userDatastoreSlug(user)) : undefined;
}

export function defaultUserMemoryMarkdown(user: AuthUser): string {
  const profile = user.profile || { researchInterests: [], publicInfo: [] };
  const lines = [
    `# ${user.displayName} memory`,
    '',
    `Username: ${user.username}`,
    user.sourceProfileId ? `Source profile: ${user.sourceProfileId}` : null,
    user.position ? `Position: ${user.position}` : null,
    profile.publicRole ? `Public role: ${profile.publicRole}` : null,
    profile.publicGroup ? `Public group: ${profile.publicGroup}` : null,
    profile.researchInterests.length ? `Research interests: ${profile.researchInterests.join('; ')}` : null,
    profile.publicInfo.length ? ['Public info:', ...profile.publicInfo.map((item) => `- ${item}`)].join('\n') : null,
    '',
    '## Personal notes',
    '',
  ].filter((line): line is string => line !== null);

  return `${lines.join('\n')}\n`;
}

function clamp(value: string): string {
  return value.length > maxContextChars ? `${value.slice(0, maxContextChars)}\n[truncated]` : value;
}

async function readFirstExisting(root: string, names: string[]): Promise<{ path: string; text: string } | undefined> {
  for (const name of names) {
    const path = join(root, name);
    const relativePath = relative(root, path);
    if (relativePath.startsWith('..')) {
      continue;
    }

    try {
      const text = (await readFile(path, 'utf8')).trim();
      if (text) {
        return { path: relativePath, text: clamp(text) };
      }
    } catch {
      continue;
    }
  }

  return undefined;
}

export async function readOwnUserMemory(user: AuthUser): Promise<{ slug: string; root: string; path: string; markdown: string }> {
  const root = userDatastoreRoot(user);
  if (!root) {
    throw new Error('DATASTORE_DIR is required for user memory.');
  }

  const existing = await readFirstExisting(root, ['memory.md', 'memory.txt', 'memory.json']);
  return {
    slug: userDatastoreSlug(user),
    root,
    path: existing?.path || 'memory.md',
    markdown: existing?.text || defaultUserMemoryMarkdown(user),
  };
}

export async function writeOwnUserMemory(
  user: AuthUser,
  markdown: string,
): Promise<{ slug: string; root: string; path: string; markdown: string }> {
  if (markdown.length > maxMemoryChars) {
    throw new Error('Memory markdown is too large.');
  }

  const root = userDatastoreRoot(user);
  if (!root) {
    throw new Error('DATASTORE_DIR is required for user memory.');
  }

  await mkdir(root, { recursive: true });
  const cleanMarkdown = `${markdown.trimEnd()}\n`;
  await writeFile(join(root, 'memory.md'), cleanMarkdown, 'utf8');
  return {
    slug: userDatastoreSlug(user),
    root,
    path: 'memory.md',
    markdown: cleanMarkdown,
  };
}

export async function loadUserDatastoreContext(user: AuthUser): Promise<UserDatastoreContext | null> {
  const root = userDatastoreRoot(user);
  if (!root) {
    return null;
  }

  return {
    slug: userDatastoreSlug(user),
    root,
    profile: await readFirstExisting(root, ['profile.md', 'profile.txt', 'profile.json']),
    memory: await readFirstExisting(root, ['memory.md', 'memory.txt', 'memory.json']),
  };
}
