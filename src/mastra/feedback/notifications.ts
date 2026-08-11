import { listUsersForAdmin } from '../db/users';
import { registeredNotificationEmail, sendNotificationEmail } from '../email';
import type { FeedbackQuery } from '../db/feedback';

function configuredRecipients(): string[] {
  return (process.env.FEEDBACK_ADMIN_EMAILS || '')
    .split(/[;,]/)
    .map((email) => registeredNotificationEmail(email))
    .filter((email): email is string => Boolean(email));
}

export async function feedbackAdminRecipients(): Promise<string[]> {
  const users = await listUsersForAdmin();
  const recipients = [
    ...configuredRecipients(),
    ...users
      .filter((user) => user.role === 'administrator' && user.provisioningStatus === 'active')
      .map((user) => registeredNotificationEmail(user.email)),
  ].filter((email): email is string => Boolean(email));
  return [...new Set(recipients.map((email) => email.toLowerCase()))];
}

export async function notifyFeedbackAdmins(query: FeedbackQuery): Promise<{ recipients: number; delivered: number }> {
  const recipients = await feedbackAdminRecipients();
  const subject = `[VioScope feedback] ${query.title}`;
  const text = [
    'A new VioScope feedback request was submitted.',
    '',
    `From: ${query.submitterDisplayName} (@${query.submitterUsername})`,
    `Title: ${query.title}`,
    '',
    query.description,
    '',
    `Attachment: ${query.attachment ? query.attachment.name : 'None'}`,
    'Open VioScope → Feedback to review and respond.',
  ].join('\n');
  const delivered = await Promise.allSettled(recipients.map((to) => sendNotificationEmail({ to, subject, text })))
    .then((results) => results.filter((result) => result.status === 'fulfilled' && result.value).length);
  return { recipients: recipients.length, delivered };
}
