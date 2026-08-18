import 'dotenv/config';
import { exec } from 'node:child_process';
import { NextResponse } from 'next/server';
import { requireAdministrator } from '../../../../../src/mastra/auth/session';
import { errorResponse } from '../../../../../src/mastra/http/error-response';
import { recordAuditLog } from '../../../../../src/mastra/db/audit-log';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const admin = await requireAdministrator(request);
    const command = process.env.VIOSCOPE_RESTART_COMMAND?.trim();

    if (!command) {
      await recordAuditLog({
        actor: admin,
        action: 'admin.restart_unavailable',
        targetType: 'service',
        summary: 'Admin requested restart, but no restart command is configured.',
      });
      return NextResponse.json({ error: 'Restart command is not configured.' }, { status: 409 });
    }

    await recordAuditLog({
      actor: admin,
      action: 'admin.restart_requested',
      targetType: 'service',
      summary: 'Admin requested service restart.',
    });

    const timer = setTimeout(() => {
      exec(command, { timeout: 10_000 }, () => undefined);
    }, 250);
    timer.unref?.();

    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error, 500);
  }
}
