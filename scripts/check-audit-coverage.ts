import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const mutatingRoutePattern = /export\s+async\s+function\s+(POST|PATCH|PUT|DELETE)\b/g;

async function routeFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await routeFiles(path));
    } else if (entry.name === 'route.ts') {
      files.push(path);
    }
  }

  return files;
}

async function main() {
  const files = await routeFiles('app/api');
  const missing: string[] = [];
  const covered: string[] = [];

  for (const file of files) {
    const source = await readFile(file, 'utf8');
    mutatingRoutePattern.lastIndex = 0;
    const methods = [...source.matchAll(mutatingRoutePattern)].map((match) => match[1]);
    if (!methods.length) continue;

    if (source.includes('recordAuditLog(')) {
      covered.push(`${file} (${methods.join(',')})`);
    } else {
      missing.push(`${file} (${methods.join(',')})`);
    }
  }

  if (missing.length) {
    throw new Error(`Mutating API routes without audit logging:\n${missing.map((file) => `- ${file}`).join('\n')}`);
  }

  console.log('Audit coverage check passed.');
  console.log(JSON.stringify({ covered: covered.length, routes: covered }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
