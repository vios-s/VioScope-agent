import 'dotenv/config';
import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { NextResponse } from 'next/server';
import { parse as parseYaml } from 'yaml';
import { AuthError, canSeeAll, isUserName, requireSessionUser } from '../../../src/mastra/auth/session';
import { deriveLabState, summarizeLabState } from '../../../src/mastra/state/derive';
import { runtimeEnv } from '../../../src/mastra/runtime-config';
import { labStateSchema } from '../../../src/mastra/state/schema';
import type { DerivedLabState } from '../../../src/mastra/state/schema';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function errorResponse(error: unknown, status = 500) {
  return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
}

async function pathExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

function routePath(inputPath: string): string {
  if (isAbsolute(inputPath)) return inputPath;
  if (inputPath.startsWith('fixtures/')) {
    return join(/*turbopackIgnore: true*/ process.cwd(), 'fixtures', inputPath.slice('fixtures/'.length));
  }
  return inputPath;
}

function candidateStatePaths(): string[] {
  const labStatePath = runtimeEnv('LAB_STATE_PATH').trim();
  const datastoreDir = runtimeEnv('DATASTORE_DIR').trim();
  return [
    labStatePath,
    datastoreDir ? join(datastoreDir, 'lab-state.yaml') : '',
    datastoreDir ? join(datastoreDir, 'lab-state.yml') : '',
  ].filter(Boolean);
}

async function readLabStateYaml(path: string) {
  const state = labStateSchema.parse(parseYaml(await readFile(path, 'utf8')));
  return { path, state: deriveLabState(state) };
}

async function readConfiguredOrFixture() {
  try {
    for (const candidate of candidateStatePaths()) {
      const path = routePath(candidate);
      if (await pathExists(path)) {
        const result = await readLabStateYaml(path);
        return {
          ...result,
          source: 'configured' as const,
          warning: undefined,
        };
      }
    }
    throw new Error('No lab state file found. Set LAB_STATE_PATH or DATASTORE_DIR.');
  } catch (error) {
    const result = await readLabStateYaml(routePath('fixtures/lab-state.example.yaml'));
    return {
      ...result,
      source: 'fixture' as const,
      warning: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function GET(request: Request) {
  try {
    const user = await requireSessionUser(request);
    const { path, state, source, warning } = await readConfiguredOrFixture();
    const visibleState: DerivedLabState = canSeeAll(user)
      ? state
      : {
          ...state,
          projects: state.projects.filter((project) => isUserName(project.owner, user)),
        };

    return NextResponse.json({
      state: visibleState,
      summary: summarizeLabState(visibleState),
      source,
      warning,
      path,
    });
  } catch (error) {
    return errorResponse(error, error instanceof AuthError ? error.status : 500);
  }
}
