import { PgVector } from '@mastra/pg';
import type { PoolClient } from 'pg';
import { wikiVectorIndexName, wikiVectorDimension } from './config';

export function createWikiVectorStore() {
  const store = new PgVector({
    id: 'wiki-vector-store',
    connectionString: process.env.DATABASE_URL,
    pgPoolOptions: { max: 8, connectionTimeoutMillis: 5000 },
  });
  const clients = new Map<PoolClient, Promise<void>>();
  store.pool.on('connect', (client) => {
    clients.set(client, new Promise<void>((resolve) => client.once('end', () => {
      clients.delete(client);
      resolve();
    })));
  });
  store.pool.on('error', (error: Error & { code?: string }) => {
    console.error('PostgreSQL vector connection closed:', error.code || error.name);
  });
  const disconnect = store.disconnect.bind(store);
  store.disconnect = async () => {
    await disconnect();
    await Promise.all(clients.values());
  };
  return store;
}

export async function ensureWikiVectorIndex(vectorStore = createWikiVectorStore()) {
  await vectorStore.createIndex({
    indexName: wikiVectorIndexName,
    dimension: wikiVectorDimension,
    metric: 'cosine',
    indexConfig: {
      type: 'hnsw',
    },
    metadataIndexes: ['source', 'space', 'page_id', 'page_path'],
  });
}
