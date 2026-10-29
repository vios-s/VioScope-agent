import 'dotenv/config';
import { NextResponse } from 'next/server';
import { requireAdministrator } from '../../../src/mastra/auth/session';
import { errorResponse } from '../../../src/mastra/http/error-response';
import { auditLogDateKey, auditLogFileName, listAuditLogDays, listAuditLogs } from '../../../src/mastra/db/audit-log';

export const runtime = 'nodejs';

function today(): string {
  return auditLogDateKey();
}

export async function GET(request: Request) {
  try {
    await requireAdministrator(request);
    const url = new URL(request.url);
    const day = url.searchParams.get('day') || today();
    const [logs, days] = await Promise.all([listAuditLogs({ day, limit: 1000 }), listAuditLogDays()]);
    return NextResponse.json({
      day,
      fileName: auditLogFileName(day),
      logs,
      days,
    });
  } catch (error) {
    return errorResponse(error, 400);
  }
}
