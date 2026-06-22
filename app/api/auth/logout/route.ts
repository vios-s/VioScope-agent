import { NextResponse } from 'next/server';
import { clearSessionCookie, sessionUserFromRequest } from '../../../../src/mastra/auth/session';
import { recordAuditLog } from '../../../../src/mastra/db/audit-log';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const user = await sessionUserFromRequest(request);
  if (user) {
    await recordAuditLog({
      actor: user,
      action: 'auth.logout',
      targetType: 'user',
      targetId: user.username,
      summary: 'User logged out.',
    });
  }
  const response = NextResponse.json({ ok: true });
  clearSessionCookie(response);
  return response;
}
