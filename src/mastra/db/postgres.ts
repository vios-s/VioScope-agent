import { PgVector } from '@mastra/pg';

export function createPostgresClient(id = 'vioscope-postgres') {
  return new PgVector({
    id,
    connectionString: process.env.DATABASE_URL,
  });
}
