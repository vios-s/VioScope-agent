import 'dotenv/config';
import {
  buildThemeMeetingReminderRun,
  renderThemeMeetingPlan,
  sendThemeMeetingAgendaEmails,
  sendThemeMeetingReminderEmails,
} from '../src/mastra/theme-meetings/planner';
import { themeReminderActionSchema, type ThemeReminderAction } from '../src/mastra/theme-meetings/schema';

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

async function main() {
  const rawAction = argValue('action') || 'agenda_cutoff';
  const parsedAction = themeReminderActionSchema.safeParse(rawAction);
  const meetingDate = argValue('date');

  if (!parsedAction.success) {
    throw new Error(
      'Use --action=first_reminder, --action=gentle_missing_update_reminder, --action=manual_missing_update_reminder, or --action=agenda_cutoff.',
    );
  }

  const action: ThemeReminderAction = parsedAction.data;
  const run = await buildThemeMeetingReminderRun(action, { meetingDate });
  const emails = await sendThemeMeetingReminderEmails(run.notifications);
  const agendaEmails =
    action === 'agenda_cutoff'
      ? await sendThemeMeetingAgendaEmails(run.plan, run.config)
      : { sent: 0, skipped: 0, failed: 0 };

  console.log(run.markdown);
  console.log(`\n# Email Notifications\n\nSent: ${emails.sent}\nSkipped: ${emails.skipped}\nFailed: ${emails.failed}`);

  if (action === 'agenda_cutoff') {
    console.log('\n# Agenda Message\n');
    console.log(renderThemeMeetingPlan(run.plan));
    console.log(
      `\n# Agenda Email Notifications\n\nSent: ${agendaEmails.sent}\nSkipped: ${agendaEmails.skipped}\nFailed: ${agendaEmails.failed}`,
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
