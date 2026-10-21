# Theme agenda circulation

| UK local time | Circulation | Recipients |
| --- | --- | --- |
| Tuesday 13:00 | Draft agenda preview | Active members of that specific theme only |
| Wednesday 08:00 | Cutoff agenda | Members, configured PIs/admin and opted-in subscribers, scoped by theme |

The draft shows submitted discussion slots, including deep dives, and lists people who have not
submitted yet. Members may adjust their own update, slot or presentation plans until the configured
cutoff. Sending a draft does not close submissions, create progress reminders, mark anyone late, or
suggest skipping the meeting. The cutoff circulation reads the latest saved updates and remains
advisory until a coordinator, PI or administrator confirms it.

PI, administrator and coordinator roles do not expand the draft audience. For example, an administrator
who is a member of D receives only D's draft; a subscriber to C receives C's cutoff agenda but no draft.
Both phases respect the account's theme meeting email preference, omit cancelled meetings and have
separate delivery receipts, so a preview or retry does not suppress the cutoff agenda.

Install `infra/systemd/vioscope-theme-meeting-preview.timer` alongside the existing
`vioscope-theme-meeting@.service`. The shared service runs
`npm run theme-meeting:cron -- --action=agenda_preview`. Keep the external configuration's
`agenda_preview` weekday/time and the systemd calendar in sync, using `Europe/London` for both.
Do not manually run circulation commands against real accounts as a test.

Validation: `npm run check:theme-agenda-preview` uses a disposable database and in-memory mail.
