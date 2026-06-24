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
    auth: user ? { user, pass } : undefined,
    connectionTimeout: timeout,
    greetingTimeout: timeout,
    socketTimeout: timeout,
  });

  await transport.sendMail({
    from: process.env.SMTP_FROM || 'VioScope <noreply@vioscope.local>',
    to,
    subject: input.subject,
    text: input.text,
  });
  return true;
}
