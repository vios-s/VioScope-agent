import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { ensureUsersTable, upsertPublicTeamProfiles } from '../src/mastra/db/users';
import { parsePublicTeamProfilesMarkdown } from '../src/mastra/team/public-profiles';

type CliOptions = {
  profilesPath: string;
  apply: boolean;
  sourceUrl?: string;
};

function printUsage() {
  console.log(`Usage: npm run users:import-team -- [profiles.md] [options]

Options:
  --apply              Upsert public profile rows and activate profile-only accounts.
  --source-url <url>   Source URL to store with imported profiles.

Default profiles path:
  TEAM_PROFILE_MARKDOWN

Without --apply this performs a dry run and writes nothing.
`);
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${flag}`);
  }

  return value;
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    profilesPath: process.env.TEAM_PROFILE_MARKDOWN || '',
    apply: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    }

    if (arg === '--apply') {
      options.apply = true;
      continue;
    }

    if (arg === '--source-url') {
      options.sourceUrl = requireValue(args, index, arg);
      index += 1;
      continue;
    }

    if (arg.startsWith('--')) {
      throw new Error(`Unknown option: ${arg}`);
    }

    options.profilesPath = arg;
  }

  return options;
}

function sourceUrlFromMarkdown(markdown: string): string {
  const match = markdown.match(/^Source:\s*(.+)$/m);
  return match?.[1]?.trim() || 'https://vios.science/team/';
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.profilesPath) {
    throw new Error('Set TEAM_PROFILE_MARKDOWN or pass a profiles Markdown path.');
  }

  const markdown = await readFile(options.profilesPath, 'utf8');
  const profiles = parsePublicTeamProfilesMarkdown(markdown);
  const sourceUrl = options.sourceUrl || sourceUrlFromMarkdown(markdown);

  if (!profiles.length) {
    throw new Error(`No public team profiles parsed from ${options.profilesPath}.`);
  }

  const summary = {
    profilesPath: options.profilesPath,
    sourceUrl,
    count: profiles.length,
    groups: profiles.reduce<Record<string, number>>((accumulator, profile) => {
      accumulator[profile.group] = (accumulator[profile.group] || 0) + 1;
      return accumulator;
    }, {}),
    sampleUsers: profiles.slice(0, 5).map((profile) => ({
      username: profile.username,
      displayName: profile.name,
      publicRole: profile.role,
      publicGroup: profile.group,
      researchInterests: profile.researchInterests,
    })),
  };

  if (!options.apply) {
    console.log(JSON.stringify({ mode: 'dry-run', ...summary }, null, 2));
    return;
  }

  await ensureUsersTable();
  const records = await upsertPublicTeamProfiles(profiles, { sourceUrl });
  console.log(
    JSON.stringify(
      {
        mode: 'applied',
        ...summary,
        upserted: records.length,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
