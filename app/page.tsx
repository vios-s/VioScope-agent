import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import packageJson from '../package.json';
import { OperationsConsole } from './operations-console';

// Production builds write .next/BUILD_ID before prerendering; dev may hold a stale one, so skip it there.
function buildId() {
  if (process.env.NODE_ENV !== 'production') return null;
  try {
    return readFileSync(join(process.cwd(), '.next', 'BUILD_ID'), 'utf8').trim() || null;
  } catch {
    return null;
  }
}

export default function Page() {
  return <OperationsConsole appInfo={{ version: packageJson.version, buildId: buildId() }} />;
}
