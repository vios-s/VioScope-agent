import 'dotenv/config';
import { NextResponse } from 'next/server';
import { AuthError, canSeeAll, isUserName, requireSessionUser } from '../../../src/mastra/auth/session';
import { summarizeLabState } from '../../../src/mastra/state/derive';
import { readLabState } from '../../../src/mastra/state/loader';
import type { DerivedLabState } from '../../../src/mastra/state/schema';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function errorResponse(error: unknown, status = 500) {
  return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
}

async function readConfiguredOrFixture() {
  try {
    const result = await readLabState();
    return {
      ...result,
      source: result.path.includes('/fixtures/') ? 'fixture' as const : 'configured' as const,
      warning: undefined,
    };
  } catch (error) {
    const result = await readLabState({ statePath: 'fixtures/lab-state.example.yaml' });
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
