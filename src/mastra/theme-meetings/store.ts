import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { runtimeEnv } from '../runtime-config';
import {
  themeMeetingConfigSchema,
  themeMeetingEmailDeliveriesFileSchema,
  themeMeetingNotificationsFileSchema,
  themeMeetingUpdatesFileSchema,
  type ThemeMeetingConfig,
  type ThemeMeetingEmailDelivery,
  type ThemeMeetingNotification,
  type ThemeMeetingUpdate,
  type ThemeMeetingUpdatesFile,
} from './schema';

export type ThemeMeetingStoreOptions = {
  configPath?: string;
  emailDeliveriesPath?: string;
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

  return candidates;
}

async function resolveFirstExisting(paths: string[], label: string): Promise<string> {
  for (const candidate of paths) {
    const resolved = resolveFromCwd(candidate);
    if (await pathExists(resolved)) {
      return resolved;
    }
  }

  throw new Error(`No ${label} found. Set THEME_MEETING_CONFIG_PATH or DATASTORE_DIR.`);
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

export function resolveThemeMeetingEmailDeliveriesPath(emailDeliveriesPath?: string): string {
  if (emailDeliveriesPath) {
    return resolveFromCwd(emailDeliveriesPath);
  }

  const configuredEmailDeliveriesPath = runtimeEnv('THEME_MEETING_EMAIL_DELIVERIES_PATH').trim();
  if (configuredEmailDeliveriesPath) {
    return resolveFromCwd(configuredEmailDeliveriesPath);
  }

  const datastoreDir = runtimeEnv('DATASTORE_DIR').trim();
  if (datastoreDir) {
    return resolveFromCwd(join(datastoreDir, 'theme-meeting-email-deliveries.yaml'));
  }

  return fallbackRuntimePath('theme-meeting-email-deliveries.yaml');
}

function themeMeetingEmailDeliveryClaimPath(id: string, options: ThemeMeetingStoreOptions = {}): string {
  return join(`${resolveThemeMeetingEmailDeliveriesPath(options.emailDeliveriesPath)}.claims`, encodeURIComponent(id));
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

export async function readThemeMeetingEmailDeliveries(
  options: ThemeMeetingStoreOptions = {},
): Promise<{ path: string; deliveries: ThemeMeetingEmailDelivery[] }> {
  const path = resolveThemeMeetingEmailDeliveriesPath(options.emailDeliveriesPath);
  if (!(await pathExists(path))) {
    return { path, deliveries: [] };
  }

  const file = themeMeetingEmailDeliveriesFileSchema.parse(parseYaml(await readFile(/*turbopackIgnore: true*/ path, 'utf8')) || {});
  return { path, deliveries: file.deliveries };
}

async function writeYaml(path: string, value: unknown) {
  await mkdir(/*turbopackIgnore: true*/ dirname(path), { recursive: true });
  await writeFile(/*turbopackIgnore: true*/ path, stringifyYaml(value), 'utf8');
}

function normalizeUpdatePart(value: string | null | undefined): string {
  return value ? value.trim().toLowerCase().replace(/\s+/g, ' ') : '';
}

function updateMemberKeys(update: Pick<ThemeMeetingUpdate, 'member' | 'member_username'>): string[] {
  return [
    update.member_username ? `u:${normalizeUpdatePart(update.member_username)}` : '',
    update.member ? `n:${normalizeUpdatePart(update.member)}` : '',
  ].filter(Boolean);
}

function updateKey(update: Pick<ThemeMeetingUpdate, 'meeting_date' | 'theme_id' | 'member' | 'member_username'>): string {
  return [
    update.meeting_date,
    update.theme_id,
    update.member_username ? `u:${update.member_username}` : `n:${update.member}`,
  ]
    .map(normalizeUpdatePart)
    .join('::');
}

function sameUpdateSlot(
  left: Pick<ThemeMeetingUpdate, 'meeting_date' | 'theme_id' | 'member' | 'member_username'>,
  right: Pick<ThemeMeetingUpdate, 'meeting_date' | 'theme_id' | 'member' | 'member_username'>,
): boolean {
  if (left.meeting_date !== right.meeting_date || normalizeUpdatePart(left.theme_id) !== normalizeUpdatePart(right.theme_id)) {
    return false;
  }

  const rightKeys = new Set(updateMemberKeys(right));
  return updateMemberKeys(left).some((key) => rightKeys.has(key));
}

export async function saveThemeMeetingUpdate(
  update: ThemeMeetingUpdate,
  options: ThemeMeetingStoreOptions = {},
): Promise<ThemeMeetingUpdatesFile> {
  const path = resolveThemeMeetingUpdatesPath(options.updatesPath);
  const { updates } = await readThemeMeetingUpdates(options);
  const nextUpdates = updates.filter((current) => !sameUpdateSlot(current, update));
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

export async function hasThemeMeetingEmailDelivery(
  id: string,
  options: ThemeMeetingStoreOptions = {},
): Promise<boolean> {
  const { deliveries } = await readThemeMeetingEmailDeliveries(options);
  return deliveries.some((delivery) => delivery.id === id);
}

export async function saveThemeMeetingEmailDelivery(
  delivery: ThemeMeetingEmailDelivery,
  options: ThemeMeetingStoreOptions = {},
): Promise<ThemeMeetingEmailDelivery[]> {
  const path = resolveThemeMeetingEmailDeliveriesPath(options.emailDeliveriesPath);
  const existing = (await readThemeMeetingEmailDeliveries(options)).deliveries;
  const byId = new Map(existing.map((current) => [current.id, current]));
  byId.set(delivery.id, delivery);

  const deliveries = [...byId.values()].sort((a, b) => b.sent_at.localeCompare(a.sent_at));
  await writeYaml(path, { deliveries });
  return deliveries;
}

export async function claimThemeMeetingEmailDelivery(
  id: string,
  options: ThemeMeetingStoreOptions = {},
): Promise<boolean> {
  if (await hasThemeMeetingEmailDelivery(id, options)) return false;

  const path = themeMeetingEmailDeliveryClaimPath(id, options);
  await mkdir(/*turbopackIgnore: true*/ dirname(path), { recursive: true });

  try {
    await mkdir(/*turbopackIgnore: true*/ path);
    return true;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') {
      return false;
    }
    throw error;
  }
}

export async function releaseThemeMeetingEmailDeliveryClaim(
  id: string,
  options: ThemeMeetingStoreOptions = {},
): Promise<void> {
  await rm(/*turbopackIgnore: true*/ themeMeetingEmailDeliveryClaimPath(id, options), { recursive: true, force: true });
}
