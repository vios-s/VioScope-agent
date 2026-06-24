import 'dotenv/config';
import { access } from 'node:fs/promises';
import { delimiter } from 'node:path';
import { NextResponse } from 'next/server';
import { AuthError, requireAdministrator } from '../../../../src/mastra/auth/session';
import {
  listAdminAppSettings,
  restartCommandConfigured,
  updateAppSettings,
  type AdminAppSetting,
} from '../../../../src/mastra/db/app-settings';
import { recordAuditLog } from '../../../../src/mastra/db/audit-log';

export const runtime = 'nodejs';

type PathStatus = {
  state: 'ok' | 'missing' | 'not_configured';
  detail: string;
};

function errorResponse(error: unknown, status = 500) {
  return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
}

async function pathStatus(setting: AdminAppSetting): Promise<PathStatus | undefined> {
  if (setting.valueType !== 'path') return undefined;
  if (!setting.value) return { state: 'not_configured', detail: 'Not configured.' };

  const paths = setting.key === 'VIOS_SKILLS_DIR'
    ? setting.value.split(delimiter).map((path) => path.trim()).filter(Boolean)
    : [setting.value];

  const missing: string[] = [];
  for (const path of paths) {
    try {
      await access(path);
    } catch {
      missing.push(path);
    }
  }

  return missing.length
    ? { state: 'missing', detail: `${missing.length} path(s) not readable.` }
    : { state: 'ok', detail: `${paths.length} path(s) readable.` };
}

async function configPayload() {
  const settings = await listAdminAppSettings();
  const settingsWithStatus = await Promise.all(settings.map(async (setting) => ({
    ...setting,
    status: await pathStatus(setting),
  })));

  return {
    settings: settingsWithStatus,
    restart: {
      configured: restartCommandConfigured(),
    },
  };
}

export async function GET(request: Request) {
  try {
    await requireAdministrator(request);
    return NextResponse.json(await configPayload());
  } catch (error) {
    return errorResponse(error, error instanceof AuthError ? error.status : 500);
  }
}

export async function PATCH(request: Request) {
  try {
    const admin = await requireAdministrator(request);
    const body = (await request.json()) as Record<string, unknown>;
    const settings = body.settings;
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      throw new Error('settings object is required.');
    }

    const result = await updateAppSettings({
      actorUserId: admin.id,
      settings: settings as Record<string, string | null>,
    });
    await recordAuditLog({
      actor: admin,
      action: 'admin.config_update',
      targetType: 'app_settings',
      summary: 'Admin updated runtime configuration.',
      metadata: {
        changedKeys: result.changedKeys,
        resetKeys: result.resetKeys,
        requiresRestart: [...result.changedKeys, ...result.resetKeys],
      },
    });

    return NextResponse.json(await configPayload());
  } catch (error) {
    return errorResponse(error, error instanceof AuthError ? error.status : 400);
  }
}
