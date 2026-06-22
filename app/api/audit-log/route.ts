import 'dotenv/config';
import { NextResponse } from 'next/server';
import { AuthError, requireAdministrator } from '../../../src/mastra/auth/session';
import { auditLogFileName, listAuditLogDays, listAuditLogs } from '../../../src/mastra/db/audit-log';

export const runtime = 'nodejs';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function errorResponse(error: unknown, status = 500) {
  return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
}

export async function GET(request: Request) {
  try {
    await requireAdministrator(request);
    const url = new URL(request.url);
    const day = url.searchParams.get('day') || today();
    const [logs, days] = await Promise.all([listAuditLogs({ day }), listAuditLogDays()]);
    return NextResponse.json({
      day,
      fileName: auditLogFileName(day),
      logs,
      days,
    });
  } catch (error) {
    return errorResponse(error, error instanceof AuthError ? error.status : 400);
  }
}
