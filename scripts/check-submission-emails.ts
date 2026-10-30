import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer, type Socket } from 'node:net';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPostgresClient, closePostgresPools } from '../src/mastra/db/postgres';

// Real Nodemailer traffic stays on loopback; no production account or SMTP recipient is used.
const accepted: { recipient: string; message: string }[] = [];
const attempts: { recipient: string; message: string }[] = [];
const rejected = new Set<string>();
const sockets = new Set<Socket>();
const server = createServer(socket => {
  sockets.add(socket); socket.on('close', () => sockets.delete(socket));
  socket.setTimeout(10_000, () => socket.destroy());
  socket.write('220 localhost synthetic SMTP\r\n');
  let buffer = '', recipient = '', data = false;
  let message: string[] = [];
  socket.on('data', chunk => {
    buffer += chunk.toString();
    let end: number;
    while ((end = buffer.indexOf('\r\n')) >= 0) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 2);
      if (data) {
        if (line === '.') {
          data = false;
          const delivery = { recipient, message: message.join('\r\n') }; message = [];
          attempts.push(delivery);
          if (rejected.has(recipient)) socket.write('451 synthetic temporary failure\r\n');
          else { accepted.push(delivery); socket.write('250 accepted\r\n'); }
        } else message.push(line);
      } else if (/^(EHLO|HELO) /i.test(line)) socket.write('250 localhost\r\n');
      else if (/^RCPT TO:/i.test(line)) { recipient = line.match(/<([^>]+)>/)![1]; socket.write('250 recipient accepted\r\n'); }
      else if (line === 'DATA') { data = true; socket.write('354 send content\r\n'); }
      else if (line === 'QUIT') socket.end('221 bye\r\n');
      else socket.write('250 ok\r\n');
    }
  });
});
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const original = process.env.DATABASE_URL!;
const database = `submission_email_${randomUUID().replaceAll('-', '')}`;
const directory = await mkdtemp(join(tmpdir(), 'submission-email-'));
let created = false;
try {
  await createPostgresClient().pool.query(`CREATE DATABASE "${database}"`); created = true;
  const url = new URL(original); url.pathname = '/' + database;
  Object.assign(process.env, {
    DATABASE_URL: url.toString(), DATASTORE_DIR: directory, AUTH_SECRET: 'synthetic-email-test',
    VIOSCOPE_RUNTIME_CONFIG_CACHE_PATH: join(directory, 'runtime.json'), THEME_MEETING_CONFIG_PATH: join(directory, 'themes.yaml'),
    EMAIL_NOTIFICATIONS_ENABLED: 'true', SMTP_HOST: '127.0.0.1', SMTP_PORT: String((server.address() as { port: number }).port),
    SMTP_SECURE: 'false', SMTP_IGNORE_TLS: 'true', SMTP_USER: '', SMTP_PASS: '', SMTP_TIMEOUT_MS: '1000',
    SMTP_FROM: 'VioScope <sender@example.test>', SMTP_ENVELOPE_FROM: 'sender@example.test', VIOSCOPE_BASE_URL: 'https://vioscope.example.test',
  });
  await writeFile(join(directory, 'themes.yaml'), 'timezone: Europe/London\ncycle:\n  rotation: [AB]\n  anchor_date: 2026-10-28\nthemes: []\n');
  const users = await import('../src/mastra/db/users'); await users.ensureUsersTable();
  const db = createPostgresClient();
  for (const [name, role] of [['author', 'member'], ['pdra', 'member'], ['principal', 'pi'], ['outsider', 'member']]) {
    await db.pool.query(`INSERT INTO users(id,username,display_name,email,role,provisioning_status,password_reset_required)
      VALUES($1,$2,$2,$3,$4,'active',false)`, [randomUUID(), name, `${name}@example.test`, role]);
  }
  const account = async (name: string) => (await users.getUserByUsername(name))!;
  const owner = await account('author'), pdra = await account('pdra'), pi = await account('principal');
  const preferences = async (name: string, web: boolean, email: boolean) => db.pool.query(
    `UPDATE users SET metadata=jsonb_set(metadata,'{notification_preferences}',$2::jsonb) WHERE username=$1`,
    [name, JSON.stringify({ project_progress_reminders: { web, email } })]);
  const { createProject } = await import('../src/mastra/db/projects');
  const { changeProjectWorkflow } = await import('../src/mastra/db/project-workflow');
  const { runSubmissionReminders, markSubmissionNotificationsRead } = await import('../src/mastra/submission/reminders');
  const { runSubmissionReminderEmails: run } = await import('../src/mastra/submission/reminder-emails');
  const now = new Date(), deadline = new Date(now.getTime() + 42 * 86400000).toISOString();
  const project = await createProject({ title: 'Synthetic submission email', pdraUsername: pdra.username, piUsername: pi.username }, owner);
  const plan = { venue: 'Synthetic venue', cycle: 'Synthetic', deadline, timezone: 'Europe/London' };
  await changeProjectWorkflow(project.id, { operation: 'submission', confirmed: true, currentId: null, plan, reason: 'Synthetic reminder test.' }, owner);
  const rows = async () => (await db.pool.query('SELECT *, attempts::int FROM submission_email_deliveries ORDER BY recipient_user_id,event_key')).rows;
  await preferences('author', false, true);
  await preferences('pdra', true, false);
  assert.equal((await runSubmissionReminders(now)).created, 1, 'Only PDRA has web enabled.');
  await markSubmissionNotificationsRead(pdra, undefined, true);
  assert.equal((await run(new Date(now.getTime() - 1))).sent, 0, 'No early email.');
  process.env.EMAIL_NOTIFICATIONS_ENABLED = 'false';
  assert.equal((await run(now)).sent, 0); assert.equal((await rows()).length, 0, 'Disabled delivery creates no receipt.');
  process.env.EMAIL_NOTIFICATIONS_ENABLED = 'true';
  rejected.add('author@example.test');
  assert.equal((await run(now)).failed, 1);
  assert.equal((await rows())[0].attempts, 1); assert.equal((await rows())[0].sent_at, null);
  assert.equal((await run(new Date(now.getTime() + 299_999))).failed, 0, 'No retry before five minutes.');
  assert.equal(attempts.length, 1);
  assert.equal((await run(new Date(now.getTime() + 300_000))).failed, 1);
  assert.equal((await rows())[0].attempts, 2);
  assert.equal(new Date((await rows())[0].next_attempt_at).getTime(), now.getTime() + 900_000, 'Second failure backs off ten minutes.');
  rejected.clear();
  await Promise.all([run(new Date(now.getTime() + 900_000)), run(new Date(now.getTime() + 900_000))]);
  assert.equal(accepted.length, 1, 'Concurrent workers send once.');
  assert.equal(accepted[0].recipient, 'author@example.test', 'Email works with web disabled.');
  const messageId = (message: string) => message.replace(/\r\n[ \t]+/g, ' ').match(/Message-ID:\s*(<[^>]+>)/i)![1];
  assert.equal(messageId(attempts[0].message), messageId(accepted[0].message), 'Retries reuse the stable message ID.');
  assert.match(accepted[0].message, /https:\/\/vioscope.example.test\/\?view=3Dchecklists/);
  assert.match(accepted[0].message, /Europe\/London/);
  assert.match(accepted[0].message, /Project progress reminders/);
  await run(new Date(now.getTime() + 3600_000)); assert.equal(accepted.length, 1, 'Successful delivery is not repeated.');

  await preferences('pdra', true, true);
  await db.pool.query("UPDATE users SET email='',provisioning_status='profile_only' WHERE username='pdra'");
  await run(now); assert.equal((await rows()).length, 1, 'Missing address is skipped.');
  await db.pool.query("UPDATE users SET email='pdra@example.test',provisioning_status='disabled' WHERE username='pdra'");
  await run(now); assert.equal((await rows()).length, 1, 'Inactive account is skipped.');
  await db.pool.query("UPDATE users SET provisioning_status='active' WHERE username='pdra'");
  assert.equal((await run(now)).sent, 1, 'Reading the web notice does not suppress email.');

  // A failed delivery is reconsidered, never blindly replayed after ownership/access changes.
  const codeTime = new Date(Date.parse(deadline) - 35 * 86400000);
  rejected.add('author@example.test');
  assert.equal((await run(codeTime)).failed, 1);
  const beforeRevocation = attempts.length;
  await db.pool.query("UPDATE project_records SET owner_username='outsider' WHERE id=$1", [project.id]);
  await preferences('outsider', false, false);
  await run(new Date(codeTime.getTime() + 300_000));
  assert.equal(attempts.length, beforeRevocation, 'Revoked recipient is not retried.');
  await db.pool.query("UPDATE project_records SET owner_username='author' WHERE id=$1", [project.id]);
  await preferences('author', false, false);
  await run(new Date(codeTime.getTime() + 300_000));
  assert.equal(attempts.length, beforeRevocation, 'Opting out stops pending retries.');
  await preferences('author', false, true);
  await db.pool.query(`UPDATE submission_email_deliveries SET attempts=8,claimed_until=$1,claim_token=$2 WHERE event_key LIKE '%:code_lock'`,
    [new Date(codeTime.getTime() + 900_000), randomUUID()]);
  await run(new Date(codeTime.getTime() + 899_999)); assert.equal(attempts.length, beforeRevocation, 'Unexpired crash lease blocks another send.');
  await run(new Date(codeTime.getTime() + 900_000));
  const failed = (await rows()).find(r => r.event_key.endsWith(':code_lock'))!;
  assert.equal(new Date(failed.next_attempt_at).getTime(), codeTime.getTime() + 900_000 + 6 * 3600_000, 'Expired lease recovers; backoff caps at six hours.');
  rejected.clear();
  const checkpointTime = new Date(Date.parse(deadline) - 86400000);
  await run(checkpointTime);
  const sentKeys = (await rows()).filter(r => r.sent_at).map(r => r.event_key.split(':').at(-1));
  for (const key of ['skeleton_lock', 'code_lock', 'internal_review', 'revision_lock', 'submission_clearance', 'submission_target']) assert.ok(sentKeys.includes(key), key);
  assert.ok(accepted.some(d => d.recipient === 'principal@example.test'));

  // Start a real review round; only the lead PDRA receives the independent 48-hour warning.
  await changeProjectWorkflow(project.id, { operation: 'evidence', confirmed: true, title: 'Synthetic manuscript', claim: 'Test', kind: 'document', state: 'completed', summary: 'Synthetic evidence', artifactId: null, url: 'https://example.test/v1' }, owner);
  const { getInternalReviews, changeInternalReview } = await import('../src/mastra/db/internal-reviews');
  const payload = await getInternalReviews(project.id, owner);
  await changeInternalReview(project.id, { operation: 'start', confirmed: true, previousRoundId: null, submissionId: payload.submission.id, manuscript: { label: 'v1', evidenceId: payload.evidence[0].id } }, owner);
  const round = (await getInternalReviews(project.id, owner)).rounds[0];
  const reviewTime = new Date(checkpointTime.getTime() + 1000);
  await db.pool.query('UPDATE internal_review_rounds SET created_at=$2 WHERE id=$1', [round.id, new Date(reviewTime.getTime() - 48 * 3600_000)]);
  rejected.add('pdra@example.test');
  assert.equal((await run(reviewTime)).failed, 1);
  const beforeRetarget = attempts.length;
  await changeProjectWorkflow(project.id, { operation: 'submission', confirmed: true, currentId: payload.submission.id, plan: { ...plan, deadline: new Date(reviewTime.getTime() + 90 * 86400000).toISOString() }, reason: 'Synthetic retarget cancels old pending mail.' }, owner);
  await run(new Date(reviewTime.getTime() + 300_000));
  assert.equal(attempts.length, beforeRetarget, 'Retargeting cancels pending review retries and old milestones.');
  rejected.clear();
  const newTime = new Date(reviewTime.getTime() + 48 * 86400000);
  assert.equal((await run(newTime)).sent, 2, 'New submission attempt has independent milestone receipts.');
  rejected.add('author@example.test');
  const newCodeTime = new Date(newTime.getTime() + 7 * 86400000);
  assert.equal((await run(newCodeTime)).failed, 1);
  const beforeOutcome = attempts.length;
  await db.pool.query(`UPDATE project_submissions SET result='{"outcome":"submitted"}' WHERE project_id=$1 AND is_current`, [project.id]);
  await run(new Date(newCodeTime.getTime() + 300_000));
  assert.equal(attempts.length, beforeOutcome, 'Recording submission stops pending retries.');
  await db.pool.query(`UPDATE project_submissions SET result='{}' WHERE project_id=$1 AND is_current`, [project.id]);
  rejected.clear();
  const beforeArchive = attempts.length;
  await db.pool.query("UPDATE project_records SET lifecycle='archived' WHERE id=$1", [project.id]);
  await run(new Date(newTime.getTime() + 30 * 86400000));
  assert.equal(attempts.length, beforeArchive, 'Archived projects send nothing.');
  console.log('Submission email checks passed: all T-minus audiences, 48h review, independent preferences/read state, concurrent deduplication, SMTP retries/backoff, crash recovery, revocation, retargeting and archival. Loopback SMTP only.');
} finally {
  for (const socket of sockets) socket.destroy();
  await new Promise<void>(resolve => server.close(() => resolve()));
  await closePostgresPools(); process.env.DATABASE_URL = original;
  if (created) { await createPostgresClient().pool.query(`DROP DATABASE "${database}" WITH (FORCE)`); await closePostgresPools(); }
  await rm(directory, { recursive: true, force: true });
}
