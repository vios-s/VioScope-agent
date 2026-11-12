import { mkdir, readFile } from 'node:fs/promises';
import { basename, extname, join, relative, resolve } from 'node:path';
import { atomicWrite, contentHash } from '../atomic-file';
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
        return { path: relativePath, text };
      }
    } catch {
      continue;
    }
  }

  return undefined;
}

type UserMemory = { slug: string; root: string; path: string; markdown: string; revision: string };

export async function readOwnUserMemory(user: AuthUser): Promise<UserMemory> {
  const root = userDatastoreRoot(user);
  if (!root) {
    throw new Error('DATASTORE_DIR is required for user memory.');
  }

  const existing = await readFirstExisting(root, ['memory.md', 'memory.txt', 'memory.json']);
  const markdown = existing?.text || defaultUserMemoryMarkdown(user);
  return {
    slug: userDatastoreSlug(user),
    root,
    path: existing?.path || 'memory.md',
    markdown,
    revision: contentHash(markdown),
  };
}

export async function writeOwnUserMemory(
  user: AuthUser,
  markdown: string,
): Promise<UserMemory> {
  if (markdown.length > maxMemoryChars) {
    throw new Error('Memory markdown is too large.');
  }

  const root = userDatastoreRoot(user);
  if (!root) {
    throw new Error('DATASTORE_DIR is required for user memory.');
  }

  await mkdir(root, { recursive: true });
  const cleanMarkdown = `${markdown.trimEnd()}\n`;
  // Temporary file plus rename: readers and a failed write never see a truncated memory file.
  await atomicWrite(join(root, 'memory.md'), cleanMarkdown);
  return {
    slug: userDatastoreSlug(user),
    root,
    path: 'memory.md',
    markdown: cleanMarkdown,
    revision: contentHash(cleanMarkdown.trim()), // matches the next read, which trims
  };
}

export async function loadUserDatastoreContext(user: AuthUser): Promise<UserDatastoreContext | null> {
  const root = userDatastoreRoot(user);
  if (!root) {
    return null;
  }

  const bounded = async (names: string[]) => {
    const value = await readFirstExisting(root, names);
    return value ? { ...value, text: clamp(value.text) } : undefined;
  };
  return {
    slug: userDatastoreSlug(user), root,
    profile: await bounded(['profile.md', 'profile.txt', 'profile.json']),
    memory: await bounded(['memory.md', 'memory.txt', 'memory.json']),
  };
}
