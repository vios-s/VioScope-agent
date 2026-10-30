import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextResponse } from 'next/server';
import packageJson from '../../../package.json';
import { requireSessionUser } from '../../../src/mastra/auth/session';
import { errorResponse } from '../../../src/mastra/http/error-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Production builds write .next/BUILD_ID; dev may hold a stale one, so skip it there.
function buildId() {
  if (process.env.NODE_ENV !== 'production') return null;
  try { return readFileSync(join(process.cwd(), '.next', 'BUILD_ID'), 'utf8').trim() || null; } catch { return null; }
}

/** Version details for Settings → About; signed-in accounts only, never in the public page. */
export async function GET(request: Request) {
  try {
    await requireSessionUser(request);
    return NextResponse.json({ version: packageJson.version, buildId: buildId() });
  } catch (error) { return errorResponse(error, 500); }
}
