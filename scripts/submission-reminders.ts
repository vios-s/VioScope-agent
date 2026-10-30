import 'dotenv/config';
import { runSubmissionReminders } from '../src/mastra/submission/reminders';
import { runSubmissionReminderEmails } from '../src/mastra/submission/reminder-emails';
import { closePostgresPools } from '../src/mastra/db/postgres';
try {
  const web = await runSubmissionReminders();
  const email = await runSubmissionReminderEmails();
  console.log(JSON.stringify({ ...web, email }));
  if (email.failed) process.exitCode = 1;
}
finally {await closePostgresPools();}
