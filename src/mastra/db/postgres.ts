import { AsyncLocalStorage } from 'node:async_hooks';
import { Pool, type PoolClient } from 'pg';

type Transaction = { connectionString: string; client: PoolClient; pool: Pool; failed: boolean };
type PoolEntry = { pool: Pool; clients: Set<PoolClient> };
const key = Symbol.for('vioscope.relational-database');
const globals = globalThis as typeof globalThis & { [key]?: { pools: Map<string, PoolEntry>; transactions: AsyncLocalStorage<Transaction> } };
const state = globals[key] ||= { pools: new Map(), transactions: new AsyncLocalStorage<Transaction>() };

function connectionString(): string {
  const value = process.env.DATABASE_URL?.trim();
  if (!value) throw new Error('DATABASE_URL is required.');
  return value;
}

function sharedPool(url: string): PoolEntry {
  let entry = state.pools.get(url);
  if (!entry) {
    // ponytail: one bounded relational pool per database/process; vector indexing has its own store.
    const pool = new Pool({ connectionString: url, max: 8, connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000, allowExitOnIdle: true, application_name: 'vioscope-relational' });
    const clients = new Set<PoolClient>();
    pool.on('connect', (client) => {
      clients.add(client);
      client.once('end', () => clients.delete(client));
    });
    pool.on('error', (error: Error & { code?: string }) => {
      console.error('PostgreSQL idle connection closed:', error.code || error.name);
    });
    entry = { pool, clients };
    state.pools.set(url, entry);
  }
  return entry;
}

export function createPostgresClient(_id = 'vioscope-postgres') {
  const url = connectionString();
  return {
    get pool(): Pool {
      const transaction = state.transactions.getStore();
      if (transaction) {
        if (transaction.connectionString !== url) throw new Error('A transaction cannot span different databases.');
        return transaction.pool;
      }
      return sharedPool(url).pool;
    },
    // Helpers borrow the shared pool; only an explicit shutdown closes its connections.
    async disconnect(): Promise<void> {},
  };
}

export async function withDatabaseTransaction<T>(action: () => Promise<T>): Promise<T> {
  const current = state.transactions.getStore();
  if (current) {
    try { return await action(); }
    catch (error) { current.failed = true; throw error; }
  }
  const url = connectionString();
  const pool = sharedPool(url).pool;
  const client = await pool.connect();
  const transaction: Transaction = { connectionString: url, client, pool, failed: false };
  const query = (...args: unknown[]) => {
    const sql = typeof args[0] === 'string' ? args[0].trim() : '';
    if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(sql)) {
      if (/^ROLLBACK$/i.test(sql)) transaction.failed = true;
      return Promise.resolve({ rows: [], rowCount: 0 });
    }
    return (client.query as (...values: unknown[]) => Promise<unknown>)(...args).catch((error) => {
      transaction.failed = true;
      throw error;
    });
  };
  const borrowedClient = new Proxy(client, { get(target, property) {
    if (property === 'query') return query;
    if (property === 'release') return () => undefined;
    const value = Reflect.get(target, property);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  transaction.pool = new Proxy(pool, { get(target, property) {
    if (property === 'query') return query;
    if (property === 'connect') return async () => borrowedClient;
    const value = Reflect.get(target, property);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  try {
    await client.query('BEGIN');
    const result = await state.transactions.run(transaction, action);
    if (transaction.failed) throw new Error('A nested database operation failed; the transaction was rolled back.');
    const committed = await client.query('COMMIT');
    if (committed.command !== 'COMMIT') throw new Error('Database transaction did not commit.');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Call at process/test teardown, after all work using this database has finished. */
export async function closePostgresPools(url?: string): Promise<void> {
  const entries = url ? [[url, state.pools.get(url)] as const] : [...state.pools.entries()];
  await Promise.all(entries.map(async ([connection, entry]) => {
    if (!entry) return;
    state.pools.delete(connection);
    const closed = [...entry.clients].map((client) => {
      // Idle sockets are unreferenced; keep teardown alive until their end events arrive.
      (client as PoolClient & { ref(): void }).ref();
      return new Promise<void>((resolve) => client.once('end', resolve));
    });
    await entry.pool.end();
    await Promise.all(closed);
  }));
}
