import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, rename, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createPostgresClient, withDatabaseTransaction } from "./db/postgres";

export const contentHash = (value: unknown) => createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");

// Shared by web, cron and email writers using the same database and datastore.
// Transaction locks are released by PostgreSQL on rollback or process/connection exit.
export async function withFileLock<T>(path: string, action: () => Promise<T>): Promise<T> {
  await mkdir(dirname(path), { recursive: true });
  return withDatabaseTransaction(async () => {
    const database = createPostgresClient('vioscope-file-lock');
    await database.pool.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', ['vioscope-file', resolve(path)]);
    return action();
  });
}
export async function atomicWrite(path: string, text: string): Promise<void> {
  const temp = path + "." + randomUUID() + ".tmp";
  try {
    const file = await open(temp, "wx", 0o600);
    try { await file.writeFile(text); await file.sync(); } finally { await file.close(); }
    await rename(temp, path);
  } finally { await rm(temp, { force: true }); }
}
