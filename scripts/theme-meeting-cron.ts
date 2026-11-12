import 'dotenv/config';
import {
  buildThemeMeetingReminderRun,
  reminderRunSkipReason,
  renderThemeMeetingPlan,
  sendThemeMeetingAgendaEmails,
  sendThemeMeetingReminderEmails,
  upcomingWednesday,
} from '../src/mastra/theme-meetings/planner';
import { readThemeMeetingConfig } from '../src/mastra/theme-meetings/store';
import { themeReminderActionSchema, type ThemeReminderAction } from '../src/mastra/theme-meetings/schema';

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

async function main() {
  const rawAction = argValue('action') || 'agenda_cutoff';
  const parsedAction = themeReminderActionSchema.safeParse(rawAction);
  let meetingDate = argValue('date');

  if (!parsedAction.success) {
    throw new Error(
      'Use --action=first_reminder, --action=gentle_missing_update_reminder, --action=manual_missing_update_reminder, --action=agenda_preview, or --action=agenda_cutoff.',
    );
  }

  const action: ThemeReminderAction = parsedAction.data;
  // Timer runs (no --date) target the upcoming Wednesday. The systemd timers set the actual send time; the
  // configured reminder times only open the window, so a late catch-up run (Persistent=true) or a timer that
  // fires before the configured time sends nothing. An explicit --date is an operator's decision and always runs.
  if (!meetingDate) {
    const { config } = await readThemeMeetingConfig();
    meetingDate = upcomingWednesday(new Date(), config.timezone);
    const skipReason = reminderRunSkipReason(config, action, meetingDate);
    if (skipReason) {
      console.log(`Skipped ${action} for the ${meetingDate} meeting: ${skipReason}. Nothing was sent. Keep the systemd timers at or after the configured reminder times, or pass --date to run it anyway.`);
      return;
    }
  }
  const run = await buildThemeMeetingReminderRun(action, { meetingDate });
  const emails = await sendThemeMeetingReminderEmails(run.notifications);
  const agendaEmails =
    action === 'agenda_cutoff' || action === 'agenda_preview'
      ? await sendThemeMeetingAgendaEmails(run.plan, run.config, { phase: action === 'agenda_preview' ? 'preview' : 'final' })
      : { sent: 0, skipped: 0, failed: 0 };

  console.log(run.markdown);
  console.log(`\n# Email Notifications\n\nSent: ${emails.sent}\nSkipped: ${emails.skipped}\nFailed: ${emails.failed}`);

  if (action === 'agenda_cutoff' || action === 'agenda_preview') {
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
