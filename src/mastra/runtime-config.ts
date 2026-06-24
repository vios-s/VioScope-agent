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

function loadRuntimeOverrides(): Record<string, string> {
  try {
    const fs = (process as typeof process & { getBuiltinModule?: (name: string) => unknown }).getBuiltinModule?.(
      'node:fs',
    ) as typeof import('node:fs') | undefined;
    if (!fs) {
      return {};
    }
    if (!fs.existsSync(runtimeConfigCachePath)) {
      return {};
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
