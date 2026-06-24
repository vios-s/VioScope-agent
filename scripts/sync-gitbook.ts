import 'dotenv/config';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { GitBookClient, flattenPages } from '../src/mastra/gitbook/client';
import type { GitBookRevision } from '../src/mastra/gitbook/types';
import { runtimeEnv } from '../src/mastra/runtime-config';
import { ingestGitBook } from './ingest-gitbook';

type SyncState = {
  fingerprint: string;
  revisionId: string;
  pageCount: number;
  syncedAt: string;
};

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function statePath(): string {
  const configured = arg('state-path') || runtimeEnv('GITBOOK_SYNC_STATE_PATH').trim();
  if (configured) return isAbsolute(configured) ? configured : resolve(configured);

  const datastoreDir = runtimeEnv('DATASTORE_DIR').trim();
  return datastoreDir
    ? join(datastoreDir, 'runtime', 'gitbook-sync-state.json')
    : resolve('.local', 'state', 'gitbook-sync-state.json');
}

function fingerprintRevision(revision: GitBookRevision): { fingerprint: string; pageCount: number } {
  const pages = flattenPages(revision.pages || []);
  const source = JSON.stringify({
    revisionId: revision.id,
    pages: pages
      .map((page) => ({ id: page.id, updatedAt: page.updatedAt || '', path: page.path || page.slug || '' }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  });

  return {
    fingerprint: createHash('sha256').update(source).digest('hex'),
    pageCount: pages.length,
  };
}

async function readState(path: string): Promise<SyncState | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as SyncState;
  } catch {
    return null;
  }
}

async function writeState(path: string, state: SyncState): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

async function main() {
  const path = statePath();
  const force = hasFlag('force');
  const client = new GitBookClient();
  const revision = await client.getCurrentRevision();
  const { fingerprint, pageCount } = fingerprintRevision(revision);
  const previous = await readState(path);

  if (!force && previous?.fingerprint === fingerprint) {
    console.log(`GitBook unchanged; skipped ingest. revision=${revision.id} pages=${pageCount}`);
    return;
  }

  const result = await ingestGitBook();
  await writeState(path, {
    fingerprint,
    revisionId: revision.id,
    pageCount,
    syncedAt: new Date().toISOString(),
  });
  console.log(
    `GitBook sync complete: revision=${revision.id} pages=${result.pages} chunks=${result.chunks} state=${path}`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
