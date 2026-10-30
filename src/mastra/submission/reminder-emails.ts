import { createHash, randomUUID } from 'node:crypto';
import { createPostgresClient, withDatabaseTransaction } from '../db/postgres';
import { ensureProjectTables, getProjectForUser } from '../db/projects';
import { getUserByUsername } from '../db/users';
import { notificationEmailEnabled, registeredNotificationEmail, sendNotificationEmail } from '../email';
import { projectSubmissionNotices } from './reminders';

const pool = () => createPostgresClient().pool;

/** Separate from web reconciliation: reading a notice never acknowledges its email. */
export async function runSubmissionReminderEmails(now = new Date()) {
  const result = { sent: 0, failed: 0, skipped: 0 };
  if (!notificationEmailEnabled()) return result;
  await ensureProjectTables();
  const projects = (await pool().query('SELECT DISTINCT project_id::text FROM project_submissions WHERE is_current')).rows;
  const started = Date.now();
  for (const { project_id: projectId } of projects) {
    for (const notice of await projectSubmissionNotices(projectId, now)) {
      // Leave time for shutdown before the scheduler's 240-second service timeout.
      if (Date.now() - started > 180_000) return result;
      const claim = await withDatabaseTransaction(async () => {
        await pool().query('SELECT id FROM project_records WHERE id=$1 FOR UPDATE', [projectId]);
        // Recheck every retry against current roles, permissions, preferences and completion state.
        const current = (await projectSubmissionNotices(projectId, now)).find(n => n.key === notice.key && n.username === notice.username);
        const user = await getUserByUsername(notice.username);
        const email = registeredNotificationEmail(user?.email);
        if (!current || !user || user.provisioningStatus !== 'active' || !email || !user.notificationPreferences.project_progress_reminders.email) return null;
        try { await getProjectForUser(projectId, user); } catch { return null; }
        const token = randomUUID();
        const row = (await pool().query(`INSERT INTO submission_email_deliveries
          (recipient_user_id,event_key,project_id,attempts,next_attempt_at,claim_token,claimed_until)
          VALUES($1,$2,$3,1,$4,$5,$4::timestamptz + interval '15 minutes')
          ON CONFLICT(recipient_user_id,event_key) DO UPDATE SET
            attempts=submission_email_deliveries.attempts+1,claim_token=$5,claimed_until=$4::timestamptz + interval '15 minutes'
          WHERE submission_email_deliveries.sent_at IS NULL AND submission_email_deliveries.next_attempt_at<=$4
            AND (submission_email_deliveries.claimed_until IS NULL OR submission_email_deliveries.claimed_until<=$4)
          RETURNING attempts`, [user.id, current.key, projectId, now.toISOString(), token])).rows[0];
        return row ? { userId: user.id, email, notice: current, token, attempts: Number(row.attempts) } : null;
      });
      if (!claim) { result.skipped++; continue; }

      const id = createHash('sha256').update(`${claim.userId}:${claim.notice.key}`).digest('hex');
      const base = process.env.VIOSCOPE_BASE_URL?.trim();
      const link = base && /^https?:\/\//i.test(base) ? new URL('?view=checklists', base).toString() : null;
      let sent = false;
      let errorCode = 'delivery_disabled';
      try {
        sent = await sendNotificationEmail({
          to: claim.email,
          subject: `[VioScope] ${claim.notice.title}`,
          messageId: `<submission-${id}@vioscope.local>`,
          text: [claim.notice.title, '', claim.notice.body, '',
            'Open VioScope → Checklists → Internal Review and select this project.',
            ...(link ? [link] : []), '',
            'This reminder is advisory. It does not approve a checkpoint or submit a manuscript.',
            'Manage these emails in Settings → Notifications → Project progress reminders.',
          ].join('\n'),
        });
      } catch (error) {
        // Store transport codes only; SMTP errors can contain addresses or server credentials.
        const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
        errorCode = /^[A-Z0-9_]{1,40}$/.test(code) ? code : 'delivery_failed';
      }
      // Commit each receipt independently. Later failures cannot roll back an earlier successful send.
      // SMTP cannot guarantee exactly-once delivery after an ambiguous acknowledgement or process crash.
      const retryMinutes = Math.min(360, 5 * 2 ** Math.min(claim.attempts - 1, 7));
      await pool().query(`UPDATE submission_email_deliveries SET sent_at=$4,last_error=$5,
        next_attempt_at=$6,claim_token=NULL,claimed_until=NULL
        WHERE recipient_user_id=$1 AND event_key=$2 AND claim_token=$3`,
      [claim.userId, claim.notice.key, claim.token, sent ? now.toISOString() : null, sent ? null : errorCode,
        new Date(now.getTime() + retryMinutes * 60_000).toISOString()]);
      if (sent) result.sent++; else result.failed++;
    }
  }
  return result;
}
