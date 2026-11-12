import { isAbsolute, join } from 'node:path';

let runtimeOverrides: Record<string, string> | null = null;

function runtimeCachePath(): string {
  const configuredPath = process.env.VIOSCOPE_RUNTIME_CONFIG_CACHE_PATH;
  if (configuredPath) {
    return isAbsolute(configuredPath) ? configuredPath : join(/*turbopackIgnore: true*/ process.cwd(), configuredPath);
  }

  return join(/*turbopackIgnore: true*/ process.cwd(), '.local', 'state', 'app-settings-runtime.json');
}

export const runtimeConfigCachePath = runtimeCachePath();

function builtinModule<T>(name: string): T | undefined {
  return (process as typeof process & { getBuiltinModule?: (name: string) => unknown }).getBuiltinModule?.(name) as T | undefined;
}

// Setting keys equal their environment names, so the stored rows map directly to overrides.
const storedSettingsScript = `
const { Client } = require('pg');
const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 3000 });
client.connect()
  .then(() => client.query('SELECT key, value FROM app_settings'))
  .then((result) => result.rows, (error) => (error.code === '42P01' ? [] : Promise.reject(error)))
  .then((rows) => { process.stdout.write(JSON.stringify(Object.fromEntries(rows.map((row) => [row.key, row.value])))); return client.end(); })
  .catch(() => process.exit(1));
`;

/**
 * The cache file can be lost (cleanup of `.local`, another checkout); the saved database settings then
 * remain the source of truth. An explicitly configured cache path (checks, isolated previews) stays
 * file-only, so a copied database never redirects an isolated run to live paths.
 */
// ponytail: one synchronous child process per start while no cache file exists; write the cache at startup if that ever matters.
function loadStoredOverrides(): Record<string, string> {
  if (process.env.VIOSCOPE_RUNTIME_CONFIG_CACHE_PATH || !process.env.DATABASE_URL?.trim()) {
    return {};
  }
  try {
    const childProcess = builtinModule<typeof import('node:child_process')>('node:child_process');
    if (!childProcess) {
      return {};
    }
    const output = childProcess.execFileSync(process.execPath, ['-e', storedSettingsScript], {
      encoding: 'utf8',
      timeout: 10000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return JSON.parse(output) as Record<string, string>;
  } catch {
    console.warn('Saved admin settings could not be read from the database; environment values are in use.');
    return {};
  }
}

function loadRuntimeOverrides(): Record<string, string> {
  try {
    const fs = builtinModule<typeof import('node:fs')>('node:fs');
    if (!fs) {
      return {};
    }
    if (!fs.existsSync(runtimeConfigCachePath)) {
      return loadStoredOverrides();
    }

    const parsed = JSON.parse(fs.readFileSync(runtimeConfigCachePath, 'utf8'));
    const settings = parsed?.settings;
    if (!settings || typeof settings !== 'object') {
      return {};
    }

    return Object.fromEntries(
      Object.entries(settings).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    );
  } catch {
    return {};
  }
}

export function runtimeEnv(name: string, fallback = ''): string {
  runtimeOverrides ||= loadRuntimeOverrides();
  return runtimeOverrides[name] ?? process.env[name] ?? fallback;
}

export function runtimeEnvNumber(name: string, fallback: number): number {
  const parsed = Number.parseFloat(runtimeEnv(name, String(fallback)));
  return Number.isFinite(parsed) ? parsed : fallback;
}
