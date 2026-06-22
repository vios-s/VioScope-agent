import 'dotenv/config';
import { buildThemeMeetingReminderRun, renderThemeMeetingPlan } from '../src/mastra/theme-meetings/planner';
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

  console.log(run.markdown);

  if (action === 'agenda_cutoff') {
    console.log('\n# Agenda Message\n');
    console.log(renderThemeMeetingPlan(run.plan));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
