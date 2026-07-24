import 'dotenv/config';
import { NextResponse } from 'next/server';
import { notificationEmailEnabled, sendNotificationEmail } from '../../../../src/mastra/email';
import { recordAuditLog } from '../../../../src/mastra/db/audit-log';
import { requestPasswordReset } from '../../../../src/mastra/db/users';

export const runtime = 'nodejs';

const acceptedMessage = 'If an active account matches these details, a temporary password has been sent to its registered email address.';

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export async function POST(request: Request) {
  try {
    if (!notificationEmailEnabled()) {
      return NextResponse.json({ error: 'Password reset email is currently unavailable. Please contact an administrator.' }, { status: 503 });
    }

    const body = (await request.json()) as Record<string, unknown>;
    const identifier = text(body.identifier);
    if (!identifier) {
      return NextResponse.json({ error: 'Enter your username or registered email address.' }, { status: 400 });
    }

    const reset = await requestPasswordReset(identifier);
    if (!reset) {
      await recordAuditLog({
        action: 'auth.password_reset_requested',
        targetType: 'user',
        summary: 'Password reset requested for an unavailable, unregistered, or rate-limited account.',
      });
      return NextResponse.json({ message: acceptedMessage });
    }

    try {
      await sendNotificationEmail({
        to: reset.email,
        subject: 'Your VioScope temporary password',
        text: `A VioScope password reset was requested for ${reset.username}.\n\nTemporary password: ${reset.temporaryPassword}\n\nUse it once within 15 minutes to sign in. You will then be required to set a new password. If you did not request this, you can ignore this email.`,
      });
    } catch {
      await recordAuditLog({
        action: 'auth.password_reset_email_failed',
        targetType: 'user',
        targetId: reset.username,
        summary: 'Password reset email could not be sent.',
      });
      return NextResponse.json({ error: 'Password reset email is currently unavailable. Please contact an administrator.' }, { status: 503 });
    }

    await recordAuditLog({
      action: 'auth.password_reset_email_sent',
      targetType: 'user',
      targetId: reset.username,
      summary: 'Password reset temporary password sent.',
      metadata: { expiresAt: reset.expiresAt },
    });
    return NextResponse.json({ message: acceptedMessage });
  } catch {
    return NextResponse.json({ error: 'Password reset email is currently unavailable. Please contact an administrator.' }, { status: 503 });
  }
}
