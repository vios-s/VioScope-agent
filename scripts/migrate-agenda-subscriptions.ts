import 'dotenv/config';
import { listThemeAgendaSubscriptions, setThemeAgendaSubscription } from '../src/mastra/db/theme-agenda-subscriptions';
import { listUsersForAdmin } from '../src/mastra/db/users';
import { isThemeAgendaSubscriptionRequired } from '../src/mastra/theme-meetings/agenda-recipients';
import { readThemeMeetingConfig } from '../src/mastra/theme-meetings/store';

// Agenda emails no longer go to PIs and administrators automatically. Before that change is deployed, give every account
// that received them only because of that status (config pi_users/administrator_user, active pi/administrator accounts)
// an explicit subscription to every configured theme, so nobody silently stops receiving agendas. Idempotent.
// Usage: node --import tsx scripts/migrate-agenda-subscriptions.ts [--apply]   (dry run by default)
const apply = process.argv.includes('--apply');
const normalize = (value: string) => value.trim().toLowerCase();

const { path, config } = await readThemeMeetingConfig();
const users = await listUsersForAdmin();
const leaders = new Set([...config.pi_users, config.administrator_user || ''].map(normalize).filter(Boolean));
const candidates = users.filter((user) => user.provisioningStatus === 'active' && user.role !== 'service' &&
  (leaders.has(normalize(user.username)) || user.role === 'pi' || user.role === 'administrator'));
const existing = new Set((await listThemeAgendaSubscriptions()).map((entry) => `${normalize(entry.username)}|${entry.themeId}`));

const planned = candidates.flatMap((user) => config.themes
  .filter((theme) => !isThemeAgendaSubscriptionRequired(config, theme.theme_id, user.username))
  .filter((theme) => !existing.has(`${normalize(user.username)}|${theme.theme_id}`))
  .map((theme) => ({ user, themeId: theme.theme_id })));

console.log(`Theme config: ${path}`);
console.log(`Accounts previously included as PI/administrator: ${candidates.map((user) => user.username).join(', ') || 'none'}`);
for (const { user, themeId } of planned) console.log(`${apply ? 'Subscribing' : 'Would subscribe'} @${user.username} to Theme ${themeId}`);
if (apply) for (const { user, themeId } of planned) await setThemeAgendaSubscription(user.id, themeId, true);
console.log(`${apply ? 'Inserted' : 'Would insert'} ${planned.length} subscription(s); ${existing.size} already present.${apply ? '' : ' Re-run with --apply to write.'}`);
process.exit(0);
