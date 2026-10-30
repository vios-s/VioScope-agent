import 'dotenv/config';
import { NextResponse } from 'next/server';
import { AuthError, canSeeAll, requireSessionUser } from '../../../../src/mastra/auth/session';
import { errorResponse } from '../../../../src/mastra/http/error-response';
import { recordAuditLog } from '../../../../src/mastra/db/audit-log';
import { listUsersForAdmin, type AuthUser } from '../../../../src/mastra/db/users';
import { canManageTheme } from '../../../../src/mastra/theme-meetings/access';
import { contentHash, withFileLock } from '../../../../src/mastra/atomic-file';
import { themeMeetingConfigSchema, time24Pattern, type ThemeMeetingConfig } from '../../../../src/mastra/theme-meetings/schema';
import { readThemeMeetingConfig, resolveThemeMeetingConfigPath, writeThemeMeetingConfig } from '../../../../src/mastra/theme-meetings/store';

export const runtime = 'nodejs';

type ThemeSettingsUser = Pick<AuthUser, 'id' | 'username' | 'displayName' | 'role' | 'provisioningStatus'>;

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

// A coordinator must stay a member of their theme; a legacy coordinator who was never a member is left as configured.
function assertCoordinatorsStayMembers(current: ThemeMeetingConfig, next: ThemeMeetingConfig) {
  for (const theme of next.themes) {
    const coordinator = normalizeUsername(theme.coordinator_user);
    if (!coordinator || (theme.member_users || []).includes(coordinator)) continue;
    const before = current.themes.find((candidate) => candidate.theme_id === theme.theme_id);
    const unchangedLegacy = before
      && normalizeUsername(before.coordinator_user) === coordinator
      && !(before.member_users || []).map(normalizeUsername).includes(coordinator);
    if (!unchangedLegacy) {
      throw new Error(`The coordinator of Theme ${theme.theme_id} must remain a member of that theme.`);
    }
  }
}

function validateKnownReminders(config: ThemeMeetingConfig) {
  for (const reminder of config.reminders) {
    const time = reminder.time;
    if (time !== undefined && (typeof time !== 'string' || !time24Pattern.test(time))) {
      throw new Error('Reminder times must use a 24-hour time between 00:00 and 23:59.');
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
    // Opaque revision of the whole stored file; PATCH must echo it so concurrent edits are not overwritten.
    revision: contentHash(config),
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
    return errorResponse(error, 500);
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireSessionUser(request);
    const body = (await request.json()) as Record<string, unknown>;
    if (!body.config || typeof body.config !== 'object' || Array.isArray(body.config)) {
      throw new Error('config object is required.');
    }

    const revision = typeof body.revision === 'string' ? body.revision : '';
    const path = await resolveThemeMeetingConfigPath();
    // Hold the file lock across read-check-write so a concurrent save cannot be silently overwritten.
    const { changedThemeIds, globalEdit } = await withFileLock(path, async () => {
      const { config: currentConfig } = await readThemeMeetingConfig({ configPath: path });
      const editableIds = editableThemeIds(currentConfig, user);
      if (!editableIds.length) {
        throw new AuthError('Theme meeting settings are only available to coordinators, PIs, and administrators.', 403, 'forbidden');
      }
      if (!revision || contentHash(currentConfig) !== revision) {
        throw new AuthError('This configuration changed while you were editing. Load the latest version before saving.', 409, 'conflict');
      }
      const usersByUsername = await activeUserMap();

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
        // Unchanged copies of other themes are tolerated (the form sends the whole draft); a change is refused, never ignored.
        const memberKey = (users: string[] | undefined) => JSON.stringify((users || []).map((name) => name.trim().toLowerCase()));
        if (requestedThemes.some((theme) => !editableIds.includes(theme.theme_id)
          && memberKey(theme.member_users) !== memberKey(currentConfig.themes.find((current) => current.theme_id === theme.theme_id)?.member_users))) {
          throw new AuthError('You can only change members of themes you coordinate.', 403, 'forbidden');
        }
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

      assertCoordinatorsStayMembers(currentConfig, nextConfig);
      await writeThemeMeetingConfig(nextConfig, { configPath: path });
      return { changedThemeIds, globalEdit };
    });

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
    return errorResponse(error, 400);
  }
}
