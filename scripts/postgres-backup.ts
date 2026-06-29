import 'dotenv/config';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const [action, ...rawArgs] = process.argv.slice(2);
const yes = rawArgs.includes('--yes');
const target = rawArgs.find((arg) => !arg.startsWith('--'));
const databaseUrl = process.env.DATABASE_URL;

function usage(): never {
  console.error(`Usage:
  npm run db:backup -- [backup-file.dump]
  npm run db:snapshot
  npm run db:restore -- <backup-file.dump|backup-file.sql> --yes
`);
  process.exit(1);
}

function dateStamp(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function backupDir() {
  return resolve(process.env.POSTGRES_BACKUP_DIR || 'backups');
}

function retentionDays() {
  const days = Number.parseInt(process.env.POSTGRES_BACKUP_RETENTION_DAYS || '14', 10);
  return Number.isFinite(days) && days > 0 ? days : 14;
}

function defaultBackupFile() {
  return join(backupDir(), `vioscope-postgres-${dateStamp()}.dump`);
}

function describeDatabaseUrl(value: string) {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.username ? `${url.username}@` : ''}${url.host}${url.pathname}`;
  } catch {
    return '<unparseable DATABASE_URL>';
  }
}

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, { stdio: 'inherit', env: process.env });
  if (result.error) {
    throw new Error(`${command} failed to start. Is PostgreSQL client tooling installed?`);
  }
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status}.`);
  }
}

function pruneSnapshots(dir: string, days: number) {
  if (!existsSync(dir)) return 0;
  const cutoffDate = new Date();
  cutoffDate.setUTCDate(cutoffDate.getUTCDate() - days + 1);
  const cutoff = dateStamp(cutoffDate);
  let deleted = 0;

  for (const fileName of readdirSync(dir)) {
    const match = /^vioscope-postgres-(\d{4}-\d{2}-\d{2})\.dump$/.exec(fileName);
    if (!match || match[1] >= cutoff) continue;
    rmSync(join(dir, fileName), { force: true });
    deleted += 1;
  }

  return deleted;
}

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for Postgres backup/restore.');
}

if (action === 'backup') {
  const file = resolve(target || defaultBackupFile());
  mkdirSync(dirname(file), { recursive: true });
  console.log(`Backing up ${describeDatabaseUrl(databaseUrl)} to ${file}`);
  run('pg_dump', ['--format=custom', '--file', file, databaseUrl]);
  if (!target) {
    const deleted = pruneSnapshots(backupDir(), retentionDays());
    if (deleted) console.log(`Pruned ${deleted} old Postgres backup snapshot(s).`);
  }
  console.log(`Postgres backup written to ${file}`);
} else if (action === 'restore') {
  if (!target) usage();
  const file = resolve(target);
  if (!yes) {
    throw new Error(`Refusing to restore ${describeDatabaseUrl(databaseUrl)} without --yes.`);
  }
  if (!existsSync(file)) {
    throw new Error(`Backup file not found: ${file}`);
  }
  console.log(`Restoring ${file} into ${describeDatabaseUrl(databaseUrl)}`);
  if (file.endsWith('.sql')) {
    run('psql', [databaseUrl, '--set', 'ON_ERROR_STOP=1', '--file', file]);
  } else {
    run('pg_restore', ['--clean', '--if-exists', '--no-owner', '--dbname', databaseUrl, file]);
  }
  console.log(`Postgres restore completed from ${file}`);
} else {
  usage();
}
