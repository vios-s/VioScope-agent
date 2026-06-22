import { readFile } from 'node:fs/promises';
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
