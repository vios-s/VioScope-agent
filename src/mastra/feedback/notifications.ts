import { createFeedbackReplyNotification } from '../db/chat';
import { getUserByUsername, listUsersForAdmin, type AuthUser } from '../db/users';
import { registeredNotificationEmail, sendNotificationEmail } from '../email';
import type { FeedbackQuery, FeedbackStatus } from '../db/feedback';

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

const statusLabels: Record<FeedbackStatus, string> = { pending: 'Pending', in_progress: 'In progress', solved: 'Solved', closed: 'Closed' };

// Tells the requester about an administrator's saved reply or status change: a web notification in the
// bell (Messages) and an email, each per the requester's "Feedback replies" preference. No notification
// for an unchanged save, a cleared reply alone, the administrator's own request, or an inactive account.
export async function notifyFeedbackRequester(
  query: FeedbackQuery,
  changed: { status: boolean; reply: boolean },
  actor: AuthUser,
): Promise<{ web: boolean; email: boolean; emailFailed?: boolean }> {
  const result: { web: boolean; email: boolean; emailFailed?: boolean } = { web: false, email: false };
  const replied = changed.reply && Boolean(query.adminNote);
  if (!changed.status && !replied) return result;
  const requester = await getUserByUsername(query.submitterUsername);
  if (!requester || requester.id === actor.id || requester.provisioningStatus !== 'active') return result;

  const preference = requester.notificationPreferences.feedback_replies;
  const status = statusLabels[query.status];
  const title = replied ? `Administrator replied to “${query.title}”` : `“${query.title}” is now ${status}`;
  const body = [`Status: ${status}.`, replied ? query.adminNote.replace(/\s+/g, ' ').slice(0, 240) : ''].filter(Boolean).join(' ');
  if (preference.web) {
    await createFeedbackReplyNotification({ recipientUserId: requester.id, actorUserId: actor.id, feedbackId: query.id, title, body });
    result.web = true;
  }
  // A failed email must not hide a web notification that was already delivered.
  if (preference.email && registeredNotificationEmail(requester.email)) try {
    result.email = await sendNotificationEmail({
      to: requester.email,
      subject: `[VioScope feedback] ${query.title}`,
      text: [
        replied ? 'An administrator replied to your VioScope feedback request.' : 'The status of your VioScope feedback request changed.',
        '',
        `Title: ${query.title}`,
        `Status: ${status}`,
        ...(query.adminNote ? ['', 'Administrator reply:', query.adminNote] : []),
        '',
        'Open VioScope → Feedback to read the request.',
        'You can change these emails in Settings → Notifications → Feedback replies.',
      ].join('\n'),
    });
  } catch {
    result.emailFailed = true;
  }
  return result;
}
