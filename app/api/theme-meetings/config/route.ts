import 'dotenv/config';
import { NextResponse } from 'next/server';
import { AuthError, canSeeAll, requireSessionUser } from '../../../../src/mastra/auth/session';
import { recordAuditLog } from '../../../../src/mastra/db/audit-log';
import { listUsersForAdmin, type AuthUser } from '../../../../src/mastra/db/users';
import { canManageTheme } from '../../../../src/mastra/theme-meetings/access';
import { themeMeetingConfigSchema, type ThemeMeetingConfig } from '../../../../src/mastra/theme-meetings/schema';
import { readThemeMeetingConfig, writeThemeMeetingConfig } from '../../../../src/mastra/theme-meetings/store';

export const runtime = 'nodejs';

type ThemeSettingsUser = Pick<AuthUser, 'id' | 'username' | 'displayName' | 'role' | 'provisioningStatus'>;

function errorResponse(error: unknown, status = 500) {
  return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
}

function normalizeUsername(value: string | null | undefined): string {
  return value ? value.trim().toLowerCase() : '';
}

function cloneConfig(config: ThemeMeetingConfig): ThemeMeetingConfig {
  return JSON.parse(JSON.stringify(config)) as ThemeMeetingConfig;
}

function editableThemeIds(config: ThemeMeetingConfig, user: AuthUser): string[] {
  return config.themes
    .filter((theme) => canSeeAll(user) || canManageTheme(config, theme.theme_id, user))
    .map((theme) => theme.theme_id);
}

async function activeUserMap(): Promise<Map<string, ThemeSettingsUser>> {
  const users = await listUsersForAdmin();
  return new Map(
    users
      .filter((user) => user.provisioningStatus === 'active' && user.role !== 'service')
      .map((user) => [normalizeUsername(user.username), user]),
  );
}

function displayNameFor(username: string, usersByUsername: Map<string, ThemeSettingsUser>): string {
  const normalized = normalizeUsername(username);
  const user = usersByUsername.get(normalized);
  if (!user) {
    throw new Error(`Theme meeting user is not an active account: ${username}`);
  }
  return user.displayName || normalized;
}

function normalizeThemeUsers(
  config: ThemeMeetingConfig,
  usersByUsername: Map<string, ThemeSettingsUser>,
  themeIds?: string[],
): ThemeMeetingConfig {
  const themeIdSet = themeIds ? new Set(themeIds) : null;
  for (const theme of config.themes) {
    if (themeIdSet && !themeIdSet.has(theme.theme_id)) continue;
    const coordinatorUsername = normalizeUsername(theme.coordinator_user);
    if (coordinatorUsername) {
      theme.coordinator_user = coordinatorUsername;
      theme.coordinator = displayNameFor(coordinatorUsername, usersByUsername);
    }

    const memberUsers = [...new Set((theme.member_users || []).map(normalizeUsername).filter(Boolean))];
    if (!memberUsers.length) {
      throw new Error(`Theme ${theme.theme_id} needs at least one active member.`);
    }
    theme.member_users = memberUsers;
    theme.members = memberUsers.map((username) => displayNameFor(username, usersByUsername));
  }
  return config;
}

function validateKnownReminders(config: ThemeMeetingConfig) {
  const pattern = /^\d{2}:\d{2}$/;
  for (const reminder of config.reminders) {
    const time = reminder.time;
    if (typeof time === 'string' && !pattern.test(time)) {
      throw new Error(`Invalid reminder time: ${time}`);
    }
  }
}

async function payloadFor(user: AuthUser) {
  const { path, config } = await readThemeMeetingConfig();
  const usersByUsername = await activeUserMap();
  const editableIds = editableThemeIds(config, user);
  if (!editableIds.length) {
    throw new AuthError('Theme meeting settings are only available to coordinators, PIs, and administrators.', 403, 'forbidden');
  }

  const visibleConfig = cloneConfig(config);
  visibleConfig.themes = canSeeAll(user)
    ? visibleConfig.themes
    : visibleConfig.themes.filter((theme) => editableIds.includes(theme.theme_id));

  return {
    config: visibleConfig,
    users: [...usersByUsername.values()],
    access: {
      canEditGlobal: canSeeAll(user),
      editableThemeIds: editableIds,
    },
    paths: {
      config: path,
    },
  };
}

export async function GET(request: Request) {
  try {
    const user = await requireSessionUser(request);
    return NextResponse.json(await payloadFor(user));
  } catch (error) {
    return errorResponse(error, error instanceof AuthError ? error.status : 500);
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireSessionUser(request);
    const body = (await request.json()) as Record<string, unknown>;
    if (!body.config || typeof body.config !== 'object' || Array.isArray(body.config)) {
      throw new Error('config object is required.');
    }

    const { path, config: currentConfig } = await readThemeMeetingConfig();
    const usersByUsername = await activeUserMap();
    const editableIds = editableThemeIds(currentConfig, user);
    if (!editableIds.length) {
      throw new AuthError('Theme meeting settings are only available to coordinators, PIs, and administrators.', 403, 'forbidden');
    }

    let nextConfig = cloneConfig(currentConfig);
    let changedThemeIds = editableIds;
    const globalEdit = canSeeAll(user);

    if (globalEdit) {
      nextConfig = themeMeetingConfigSchema.parse(body.config);
      validateKnownReminders(nextConfig);
      normalizeThemeUsers(nextConfig, usersByUsername);
      changedThemeIds = nextConfig.themes.map((theme) => theme.theme_id);
    } else {
      const requestedThemes = Array.isArray((body.config as Partial<ThemeMeetingConfig>).themes)
        ? ((body.config as Partial<ThemeMeetingConfig>).themes as ThemeMeetingConfig['themes'])
        : [];
      const requestedById = new Map(requestedThemes.map((theme) => [theme.theme_id, theme]));
      nextConfig.themes = nextConfig.themes.map((theme) => {
        if (!editableIds.includes(theme.theme_id)) return theme;
        const requestedTheme = requestedById.get(theme.theme_id);
        if (!requestedTheme) return theme;
        return {
          ...theme,
          member_users: requestedTheme.member_users,
        };
      });
      normalizeThemeUsers(nextConfig, usersByUsername, editableIds);
    }

    await writeThemeMeetingConfig(nextConfig, { configPath: path });
    await recordAuditLog({
      actor: user,
      action: 'theme_meeting.config_update',
      targetType: 'theme_meeting_config',
      summary: 'Theme meeting configuration updated.',
      metadata: {
        changedThemeIds,
        globalEdit,
      },
    });

    return NextResponse.json(await payloadFor(user));
  } catch (error) {
    return errorResponse(error, error instanceof AuthError ? error.status : 400);
  }
}
