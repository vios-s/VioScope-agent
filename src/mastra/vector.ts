import { PgVector } from '@mastra/pg';
import { wikiVectorIndexName, wikiVectorDimension } from './config';

export function createWikiVectorStore() {
  return new PgVector({
    id: 'wiki-vector-store',
    connectionString: process.env.DATABASE_URL,
  });
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
