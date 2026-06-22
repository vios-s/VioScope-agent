import 'dotenv/config';
import { ensureUsersTable, isUserRole, type UserRole, upsertLocalUser } from '../src/mastra/db/users';

type CliOptions = {
  username?: string;
  password?: string;
  role?: UserRole;
  email?: string;
  displayName?: string;
  forcePasswordChange: boolean;
};

function printUsage() {
  console.log(`Usage:
  npm run users:create -- <username> <role> [options]
  npm run users:create -- <username> <password> <role> [options]

Options:
  --email <email>             Optional first-login email address for notifications.
  --display-name <name>       Display name to store in the users table.
  --force-password-change     Require reset on first login.
`);
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${flag}`);
  }

  return value;
}

function parseRole(value: string): UserRole {
  if (!isUserRole(value)) {
    throw new Error(`Role must be one of: administrator, pi, organizer, member, viewer, service.`);
  }

  return value;
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    forcePasswordChange: false,
  };
  const positional: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    }

    if (arg === '--display-name') {
      options.displayName = requireValue(args, index, arg);
      index += 1;
      continue;
    }

    if (arg === '--email') {
      options.email = requireValue(args, index, arg);
      index += 1;
      continue;
    }

    if (arg === '--force-password-change') {
      options.forcePasswordChange = true;
      continue;
    }

    if (arg.startsWith('--')) {
      throw new Error(`Unknown option: ${arg}`);
    }

    positional.push(arg);
  }

  if (positional.length === 2) {
    const [username, role] = positional;
    options.username = username;
    options.password = username;
    options.role = parseRole(role);
    options.forcePasswordChange = true;
  } else {
    const [username, password, role] = positional;
    options.username = username;
    options.password = password;
    if (role) {
      options.role = parseRole(role);
    }
  }

  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.username || !options.password || !options.role) {
    printUsage();
    throw new Error('username and role are required.');
  }
  const passwordResetRequired = options.forcePasswordChange || !options.email;

  await ensureUsersTable();
  const user = await upsertLocalUser({
    username: options.username,
    password: options.password,
    email: options.email,
    role: options.role,
    displayName: options.displayName,
    passwordResetRequired,
    source: 'manual',
    metadata: { created_by: 'scripts/create-local-user.ts' },
  });

  console.log(
    JSON.stringify(
      {
        mode: 'upserted',
        username: user.username,
        displayName: user.displayName,
        email: user.email,
        role: user.role,
        provisioningStatus: user.provisioningStatus,
        passwordResetRequired: user.passwordResetRequired,
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
