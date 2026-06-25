import nodemailer from 'nodemailer';

export type NotificationEmail = {
  to: string | null | undefined;
  subject: string;
  text: string;
};

function enabled(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes((value || '').trim().toLowerCase());
}

function smtpPort(): number {
  const port = Number(process.env.SMTP_PORT || 1025);
  return Number.isFinite(port) && port > 0 ? port : 1025;
}

function smtpTimeoutMs(): number {
  const timeout = Number(process.env.SMTP_TIMEOUT_MS || 5000);
  return Number.isFinite(timeout) && timeout > 0 ? timeout : 5000;
}

function addressFromHeader(value: string): string {
  return value.match(/<([^>]+)>/)?.[1]?.trim() || value.trim();
}

export async function sendNotificationEmail(input: NotificationEmail): Promise<boolean> {
  if (!enabled(process.env.EMAIL_NOTIFICATIONS_ENABLED)) return false;
  const to = input.to?.trim();
  if (!to) return false;

  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS;
  const timeout = smtpTimeoutMs();
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST || '127.0.0.1',
    port: smtpPort(),
    secure: enabled(process.env.SMTP_SECURE),
    ignoreTLS: enabled(process.env.SMTP_IGNORE_TLS),
    auth: user ? { user, pass } : undefined,
    connectionTimeout: timeout,
    greetingTimeout: timeout,
    socketTimeout: timeout,
  });

  const from = process.env.SMTP_FROM || 'VioScope <noreply@vioscope.local>';
  await transport.sendMail({
    from,
    to,
    subject: input.subject,
    text: input.text,
    envelope: {
      from: process.env.SMTP_ENVELOPE_FROM || addressFromHeader(from),
      to,
    },
  });
  return true;
}
