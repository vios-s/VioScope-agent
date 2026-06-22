import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { runtimeConfigCachePath } from '../runtime-config';
import { createPostgresClient } from './postgres';
import { ensureUsersTable } from './users';

export type AppSettingValueType = 'string' | 'number' | 'path';
export type AppSettingSource = 'database' | 'env' | 'default';

export type AppSettingDefinition = {
  key: string;
  label: string;
  section: 'model' | 'rag' | 'paths' | 'submission' | 'operations';
  valueType: AppSettingValueType;
  envName: string;
  fallback?: string;
  description: string;
  restartRequired: boolean;
  min?: number;
  max?: number;
  integer?: boolean;
  optional?: boolean;
};

export type AdminAppSetting = AppSettingDefinition & {
  value: string;
  defaultValue: string;
  source: AppSettingSource;
  storedValue: string | null;
};

type StoredSettingRow = {
  key: string;
  value: string;
};

let ensureAppSettingsTablePromise: Promise<void> | null = null;

export const appSettingDefinitions = [
  {
    key: 'ELM_CHAT_MODEL',
    label: 'Chat model',
    section: 'model',
    valueType: 'string',
    envName: 'ELM_CHAT_MODEL',
    fallback: 'gpt-5.4-nano-2026-03-17',
    description: 'Model used by the main VioScope agent.',
    restartRequired: true,
  },
  {
    key: 'ELM_EMBED_MODEL',
    label: 'Embedding model',
    section: 'model',
    valueType: 'string',
    envName: 'ELM_EMBED_MODEL',
    fallback: 'text-embedding-3-small',
    description: 'Model used for wiki/vector embeddings.',
    restartRequired: true,
  },
  {
    key: 'WIKI_MIN_SCORE',
    label: 'Wiki min score',
    section: 'rag',
    valueType: 'number',
    envName: 'WIKI_MIN_SCORE',
    fallback: '0.35',
    description: 'Minimum vector score for wiki search results.',
    restartRequired: true,
    min: 0,
    max: 1,
  },
  {
    key: 'WIKI_CHUNK_SIZE',
    label: 'Wiki chunk size',
    section: 'rag',
    valueType: 'number',
    envName: 'WIKI_CHUNK_SIZE',
    fallback: '3200',
    description: 'Chunk size used when ingesting wiki content.',
    restartRequired: true,
    min: 200,
    max: 20000,
    integer: true,
  },
  {
    key: 'WIKI_CHUNK_OVERLAP',
    label: 'Wiki chunk overlap',
    section: 'rag',
    valueType: 'number',
    envName: 'WIKI_CHUNK_OVERLAP',
    fallback: '400',
    description: 'Overlap used when ingesting wiki chunks.',
    restartRequired: true,
    min: 0,
    max: 5000,
    integer: true,
  },
  {
    key: 'WIKI_EMBED_BATCH_SIZE',
    label: 'Embedding batch size',
    section: 'rag',
    valueType: 'number',
    envName: 'WIKI_EMBED_BATCH_SIZE',
    fallback: '32',
    description: 'Batch size used by the GitBook ingest script.',
    restartRequired: true,
    min: 1,
    max: 512,
    integer: true,
  },
  {
    key: 'DATASTORE_DIR',
    label: 'Datastore directory',
    section: 'paths',
    valueType: 'path',
    envName: 'DATASTORE_DIR',
    fallback: '/Public',
    description: 'External root for internal state, profiles, skills, and runtime data.',
    restartRequired: true,
  },
  {
    key: 'LAB_STATE_PATH',
    label: 'Lab state path',
    section: 'paths',
    valueType: 'path',
    envName: 'LAB_STATE_PATH',
    description: 'Optional explicit lab state YAML path.',
    restartRequired: true,
    optional: true,
  },
  {
    key: 'PROJECT_ARTIFACT_UPLOAD_DIR',
    label: 'Project artifact directory',
    section: 'paths',
    valueType: 'path',
    envName: 'PROJECT_ARTIFACT_UPLOAD_DIR',
    description: 'Optional upload directory for Project Manager artifacts.',
    restartRequired: true,
    optional: true,
  },
  {
    key: 'THEME_MEETING_CONFIG_PATH',
    label: 'Theme config path',
    section: 'paths',
    valueType: 'path',
    envName: 'THEME_MEETING_CONFIG_PATH',
    description: 'Optional explicit theme meeting config YAML path.',
    restartRequired: true,
    optional: true,
  },
  {
    key: 'THEME_MEETING_UPDATES_PATH',
    label: 'Theme updates path',
    section: 'paths',
    valueType: 'path',
    envName: 'THEME_MEETING_UPDATES_PATH',
    description: 'Optional explicit theme meeting updates YAML path.',
    restartRequired: true,
    optional: true,
  },
  {
    key: 'THEME_MEETING_NOTIFICATIONS_PATH',
    label: 'Theme notifications path',
    section: 'paths',
    valueType: 'path',
    envName: 'THEME_MEETING_NOTIFICATIONS_PATH',
    description: 'Optional explicit theme meeting notifications YAML path.',
    restartRequired: true,
    optional: true,
  },
  {
    key: 'VIOS_SKILLS_DIR',
    label: 'VIOS skills directories',
    section: 'paths',
    valueType: 'path',
    envName: 'VIOS_SKILLS_DIR',
    description: 'Skill roots, separated by the OS path delimiter.',
    restartRequired: true,
    optional: true,
  },
  {
    key: 'SUBMISSION_REVIEW_MAX_DRAFT_CHARS',
    label: 'Max draft characters',
    section: 'submission',
    valueType: 'number',
    envName: 'SUBMISSION_REVIEW_MAX_DRAFT_CHARS',
    fallback: '60000',
    description: 'Maximum draft text sent into the submission review harness.',
    restartRequired: true,
    min: 1000,
    max: 500000,
    integer: true,
  },
  {
    key: 'SUBMISSION_REVIEW_MAX_OUTPUT_TOKENS',
    label: 'Max output tokens',
    section: 'submission',
    valueType: 'number',
    envName: 'SUBMISSION_REVIEW_MAX_OUTPUT_TOKENS',
    fallback: '5000',
    description: 'Maximum output tokens for each submission review run.',
    restartRequired: true,
    min: 2500,
    max: 50000,
    integer: true,
  },
  {
    key: 'SUBMISSION_REVIEW_MAX_DECK_BYTES',
    label: 'Max deck bytes',
    section: 'submission',
    valueType: 'number',
    envName: 'SUBMISSION_REVIEW_MAX_DECK_BYTES',
    fallback: `${25 * 1024 * 1024}`,
    description: 'Maximum uploaded deck size.',
    restartRequired: true,
    min: 1024,
    max: 250 * 1024 * 1024,
    integer: true,
  },
  {
    key: 'SUBMISSION_REVIEW_UPLOAD_DIR',
    label: 'Upload scratch directory',
    section: 'submission',
    valueType: 'path',
    envName: 'SUBMISSION_REVIEW_UPLOAD_DIR',
    description: 'Optional upload scratch directory for submission review files.',
    restartRequired: true,
    optional: true,
  },
  {
    key: 'AUDIT_LOG_RETENTION_DAYS',
    label: 'Audit log retention days',
    section: 'operations',
    valueType: 'number',
    envName: 'AUDIT_LOG_RETENTION_DAYS',
    fallback: '90',
    description: 'Number of days to keep audit log entries before pruning.',
    restartRequired: false,
    min: 1,
    max: 3650,
    integer: true,
  },
] satisfies AppSettingDefinition[];

export const appSecretDefinitions = [
  { key: 'ELM_API_KEY', label: 'ELM API key', envName: 'ELM_API_KEY' },
  { key: 'GITBOOK_TOKEN', label: 'GitBook token', envName: 'GITBOOK_TOKEN' },
  { key: 'GITBOOK_SPACE', label: 'GitBook space', envName: 'GITBOOK_SPACE' },
  { key: 'AUTH_SECRET', label: 'Auth secret', envName: 'AUTH_SECRET' },
  { key: 'DATABASE_URL', label: 'Database URL', envName: 'DATABASE_URL' },
  { key: 'VIOSCOPE_RESTART_COMMAND', label: 'Restart command', envName: 'VIOSCOPE_RESTART_COMMAND' },
] as const;

export function settingDefinition(key: string): AppSettingDefinition | undefined {
  return appSettingDefinitions.find((definition) => definition.key === key);
}

function envDefault(definition: AppSettingDefinition): string {
  return process.env[definition.envName] ?? definition.fallback ?? '';
}

function validateSettingValue(definition: AppSettingDefinition, value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    if (definition.optional) return '';
    throw new Error(`${definition.label} is required.`);
  }

  if (definition.valueType === 'number') {
    const number = Number(trimmed);
    if (!Number.isFinite(number)) {
      throw new Error(`${definition.label} must be a number.`);
    }
    if (definition.integer && !Number.isInteger(number)) {
      throw new Error(`${definition.label} must be an integer.`);
    }
    if (definition.min !== undefined && number < definition.min) {
      throw new Error(`${definition.label} must be at least ${definition.min}.`);
    }
    if (definition.max !== undefined && number > definition.max) {
      throw new Error(`${definition.label} must be at most ${definition.max}.`);
    }
    return definition.integer ? String(number) : String(number);
  }

  if (trimmed.length > 2000) {
    throw new Error(`${definition.label} is too long.`);
  }
  return trimmed;
}

async function ensureAppSettingsTableOnce(): Promise<void> {
  await ensureUsersTable();
  const postgres = createPostgresClient('vioscope-app-settings');

  try {
    await postgres.pool.query(`
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await postgres.pool.query('CREATE INDEX IF NOT EXISTS app_settings_updated_at_idx ON app_settings (updated_at DESC)');
  } finally {
    await postgres.disconnect();
  }
}

export async function ensureAppSettingsTable(): Promise<void> {
  ensureAppSettingsTablePromise ||= ensureAppSettingsTableOnce().catch((error) => {
    ensureAppSettingsTablePromise = null;
    throw error;
  });
  return ensureAppSettingsTablePromise;
}

async function storedSettings(): Promise<Map<string, string>> {
  await ensureAppSettingsTable();
  const postgres = createPostgresClient('vioscope-app-settings');

  try {
    const result = await postgres.pool.query<StoredSettingRow>('SELECT key, value FROM app_settings');
    return new Map(result.rows.map((row: StoredSettingRow) => [row.key, row.value]));
  } finally {
    await postgres.disconnect();
  }
}

export async function getAppSettingValue(key: string): Promise<string | null> {
  const stored = await storedSettings();
  return stored.get(key) ?? null;
}

export async function syncAppSettingsRuntimeCache(): Promise<void> {
  const stored = await storedSettings();
  const settings: Record<string, string> = {};

  for (const definition of appSettingDefinitions) {
    const value = stored.get(definition.key);
    if (value !== undefined) {
      settings[definition.envName] = value;
    }
  }

  if (Object.keys(settings).length === 0) {
    await rm(runtimeConfigCachePath, { force: true });
    return;
  }

  await mkdir(dirname(runtimeConfigCachePath), { recursive: true });
  await writeFile(
    runtimeConfigCachePath,
    `${JSON.stringify({ updatedAt: new Date().toISOString(), settings }, null, 2)}\n`,
    { mode: 0o600 },
  );
}

export async function listAdminAppSettings(): Promise<AdminAppSetting[]> {
  const stored = await storedSettings();
  return appSettingDefinitions.map((definition) => {
    const defaultValue = envDefault(definition);
    const storedValue = stored.get(definition.key) ?? null;
    return {
      ...definition,
      defaultValue,
      storedValue,
      value: storedValue ?? defaultValue,
      source: storedValue === null ? (process.env[definition.envName] === undefined ? 'default' : 'env') : 'database',
    };
  });
}

export async function updateAppSettings(input: {
  actorUserId: string;
  settings: Record<string, string | null>;
}): Promise<{ changedKeys: string[]; resetKeys: string[] }> {
  await ensureAppSettingsTable();
  const postgres = createPostgresClient('vioscope-app-settings');
  const changedKeys: string[] = [];
  const resetKeys: string[] = [];

  try {
    await postgres.pool.query('BEGIN');
    for (const [key, value] of Object.entries(input.settings)) {
      const definition = settingDefinition(key);
      if (!definition) {
        throw new Error(`Unsupported setting: ${key}`);
      }

      if (value === null || value.trim() === '') {
        await postgres.pool.query('DELETE FROM app_settings WHERE key = $1', [key]);
        resetKeys.push(key);
        continue;
      }

      const cleanValue = validateSettingValue(definition, value);
      await postgres.pool.query(
        `
          INSERT INTO app_settings (key, value, updated_by_user_id, updated_at)
          VALUES ($1, $2, $3, now())
          ON CONFLICT (key) DO UPDATE
          SET value = EXCLUDED.value,
              updated_by_user_id = EXCLUDED.updated_by_user_id,
              updated_at = now()
        `,
        [key, cleanValue, input.actorUserId],
      );
      changedKeys.push(key);
    }
    await postgres.pool.query('COMMIT');
  } catch (error) {
    await postgres.pool.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await postgres.disconnect();
  }

  await syncAppSettingsRuntimeCache();

  return { changedKeys, resetKeys };
}

export function secretStatuses() {
  return appSecretDefinitions.map((secret) => ({
    key: secret.key,
    label: secret.label,
    configured: Boolean(process.env[secret.envName]?.trim()),
  }));
}

export function restartCommandConfigured(): boolean {
  return Boolean(process.env.VIOSCOPE_RESTART_COMMAND?.trim());
}
