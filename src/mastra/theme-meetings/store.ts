import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { runtimeEnv } from '../runtime-config';
import {
  themeMeetingConfigSchema,
  themeMeetingNotificationsFileSchema,
  themeMeetingUpdatesFileSchema,
  type ThemeMeetingConfig,
  type ThemeMeetingNotification,
  type ThemeMeetingUpdate,
  type ThemeMeetingUpdatesFile,
} from './schema';

export type ThemeMeetingStoreOptions = {
  configPath?: string;
  updatesPath?: string;
  notificationsPath?: string;
};

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(/*turbopackIgnore: true*/ path);
    return true;
  } catch {
    return false;
  }
}

function resolveFromCwd(path: string): string {
  if (isAbsolute(path)) return path;
  if (path.startsWith('fixtures/')) {
    return join(/*turbopackIgnore: true*/ process.cwd(), 'fixtures', path.slice('fixtures/'.length));
  }
  if (path.startsWith('.local/')) {
    return join(/*turbopackIgnore: true*/ process.cwd(), '.local', path.slice('.local/'.length));
  }
  return path;
}

function fallbackRuntimePath(fileName: string): string {
  return join(tmpdir(), 'vioscope-agent', fileName);
}

function candidateConfigPaths(): string[] {
  const candidates: string[] = [];
  const configPath = runtimeEnv('THEME_MEETING_CONFIG_PATH').trim();
  const datastoreDir = runtimeEnv('DATASTORE_DIR').trim();

  if (configPath) {
    candidates.push(configPath);
  }

  if (datastoreDir) {
    candidates.push(
      join(datastoreDir, 'theme-meeting-config.yaml'),
      join(datastoreDir, 'theme-meetings', 'config.yaml'),
    );
  }

  candidates.push('fixtures/theme-meeting-config.example.yaml');
  return candidates;
}

async function resolveFirstExisting(paths: string[], label: string): Promise<string> {
  for (const candidate of paths) {
    const resolved = resolveFromCwd(candidate);
    if (await pathExists(resolved)) {
      return resolved;
    }
  }

  throw new Error(`No ${label} found.`);
}

export async function resolveThemeMeetingConfigPath(configPath?: string): Promise<string> {
  if (configPath) {
    return resolveFromCwd(configPath);
  }

  return resolveFirstExisting(candidateConfigPaths(), 'theme meeting config');
}

export function resolveThemeMeetingUpdatesPath(updatesPath?: string): string {
  if (updatesPath) {
    return resolveFromCwd(updatesPath);
  }

  const configuredUpdatesPath = runtimeEnv('THEME_MEETING_UPDATES_PATH').trim();
  if (configuredUpdatesPath) {
    return resolveFromCwd(configuredUpdatesPath);
  }

  const datastoreDir = runtimeEnv('DATASTORE_DIR').trim();
  if (datastoreDir) {
    return resolveFromCwd(join(datastoreDir, 'theme-meeting-updates.yaml'));
  }

  return fallbackRuntimePath('theme-meeting-updates.yaml');
}

export function resolveThemeMeetingNotificationsPath(notificationsPath?: string): string {
  if (notificationsPath) {
    return resolveFromCwd(notificationsPath);
  }

  const configuredNotificationsPath = runtimeEnv('THEME_MEETING_NOTIFICATIONS_PATH').trim();
  if (configuredNotificationsPath) {
    return resolveFromCwd(configuredNotificationsPath);
  }

  const datastoreDir = runtimeEnv('DATASTORE_DIR').trim();
  if (datastoreDir) {
    return resolveFromCwd(join(datastoreDir, 'theme-meeting-notifications.yaml'));
  }

  return fallbackRuntimePath('theme-meeting-notifications.yaml');
}

export async function readThemeMeetingConfig(options: ThemeMeetingStoreOptions = {}): Promise<{
  path: string;
  config: ThemeMeetingConfig;
}> {
  const path = await resolveThemeMeetingConfigPath(options.configPath);
  return {
    path,
    config: themeMeetingConfigSchema.parse(parseYaml(await readFile(/*turbopackIgnore: true*/ path, 'utf8'))),
  };
}

export async function writeThemeMeetingConfig(
  config: ThemeMeetingConfig,
  options: ThemeMeetingStoreOptions = {},
): Promise<ThemeMeetingConfig> {
  const path = await resolveThemeMeetingConfigPath(options.configPath);
  const parsedConfig = themeMeetingConfigSchema.parse(config);
  await writeYaml(path, parsedConfig);
  return parsedConfig;
}

export async function readThemeMeetingUpdates(
  options: ThemeMeetingStoreOptions = {},
): Promise<{ path: string; updates: ThemeMeetingUpdate[] }> {
  const path = resolveThemeMeetingUpdatesPath(options.updatesPath);
  if (!(await pathExists(path))) {
    return { path, updates: [] };
  }

  const file = themeMeetingUpdatesFileSchema.parse(parseYaml(await readFile(/*turbopackIgnore: true*/ path, 'utf8')) || {});
  return { path, updates: file.updates };
}

export async function readThemeMeetingNotifications(
  options: ThemeMeetingStoreOptions = {},
): Promise<{ path: string; notifications: ThemeMeetingNotification[] }> {
  const path = resolveThemeMeetingNotificationsPath(options.notificationsPath);
  if (!(await pathExists(path))) {
    return { path, notifications: [] };
  }

  const file = themeMeetingNotificationsFileSchema.parse(parseYaml(await readFile(/*turbopackIgnore: true*/ path, 'utf8')) || {});
  return { path, notifications: file.notifications };
}

async function writeYaml(path: string, value: unknown) {
  await mkdir(/*turbopackIgnore: true*/ dirname(path), { recursive: true });
  await writeFile(/*turbopackIgnore: true*/ path, stringifyYaml(value), 'utf8');
}

function updateKey(update: Pick<ThemeMeetingUpdate, 'meeting_date' | 'theme_id' | 'member'>): string {
  return [update.meeting_date, update.theme_id, update.member].map((part) => part.toLowerCase()).join('::');
}

export async function saveThemeMeetingUpdate(
  update: ThemeMeetingUpdate,
  options: ThemeMeetingStoreOptions = {},
): Promise<ThemeMeetingUpdatesFile> {
  const path = resolveThemeMeetingUpdatesPath(options.updatesPath);
  const { updates } = await readThemeMeetingUpdates(options);
  const nextUpdates = updates.filter((current) => updateKey(current) !== updateKey(update));
  nextUpdates.push(update);
  nextUpdates.sort((a, b) => updateKey(a).localeCompare(updateKey(b)));

  const file = themeMeetingUpdatesFileSchema.parse({ updates: nextUpdates });
  await writeYaml(path, file);
  return file;
}

export async function saveThemeMeetingNotifications(
  notifications: ThemeMeetingNotification[],
  options: ThemeMeetingStoreOptions = {},
): Promise<ThemeMeetingNotification[]> {
  const path = resolveThemeMeetingNotificationsPath(options.notificationsPath);
  const existing = (await readThemeMeetingNotifications(options)).notifications;
  const byId = new Map(existing.map((notification) => [notification.id, notification]));

  for (const notification of notifications) {
    byId.set(notification.id, notification);
  }

  const nextNotifications = [...byId.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
  await writeYaml(path, { notifications: nextNotifications });
  return nextNotifications;
}
