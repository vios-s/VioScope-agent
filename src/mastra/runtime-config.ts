import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const runtimeConfigCachePath = process.env.VIOSCOPE_RUNTIME_CONFIG_CACHE_PATH
  ? resolve(process.env.VIOSCOPE_RUNTIME_CONFIG_CACHE_PATH)
  : resolve(
      /* turbopackIgnore: true */ process.cwd(),
      '.local',
      'state',
      'app-settings-runtime.json',
    );

function loadRuntimeOverrides(): Record<string, string> {
  try {
    if (!existsSync(runtimeConfigCachePath)) {
      return {};
    }

    const parsed = JSON.parse(readFileSync(runtimeConfigCachePath, 'utf8'));
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

const runtimeOverrides = loadRuntimeOverrides();

export function runtimeEnv(name: string, fallback = ''): string {
  return runtimeOverrides[name] ?? process.env[name] ?? fallback;
}

export function runtimeEnvNumber(name: string, fallback: number): number {
  const parsed = Number.parseFloat(runtimeEnv(name, String(fallback)));
  return Number.isFinite(parsed) ? parsed : fallback;
}
