import 'dotenv/config';
import { embedMany } from 'ai';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GitBookClient } from '../src/mastra/gitbook/client';
import { chunkWikiPage } from '../src/mastra/gitbook/chunk';
import { pageToWikiPage } from '../src/mastra/gitbook/extract';
import type { WikiChunk } from '../src/mastra/gitbook/types';
import { elmEmbeddingModel } from '../src/mastra/llm';
import { runtimeEnvNumber } from '../src/mastra/runtime-config';
import { createWikiVectorStore, ensureWikiVectorIndex } from '../src/mastra/vector';
import { wikiVectorIndexName } from '../src/mastra/config';

const batchSize = runtimeEnvNumber('WIKI_EMBED_BATCH_SIZE', 32);

export async function ingestGitBook() {
  const client = new GitBookClient();
  const vectorStore = createWikiVectorStore();

  try {
    await ensureWikiVectorIndex(vectorStore);

    const pageSummaries = await client.listPages();
    const chunks: WikiChunk[] = [];

    for (const summary of pageSummaries) {
      const page = await client.getPage(summary.id);
      const wikiPage = pageToWikiPage(page);

      if (!wikiPage.text) {
        continue;
      }

      chunks.push(...chunkWikiPage(wikiPage, client.space));
    }

    if (!chunks.length) {
      console.log('No GitBook chunks found to ingest.');
      return { pages: pageSummaries.length, chunks: 0 };
    }

    await vectorStore.truncateIndex({ indexName: wikiVectorIndexName });

    for (let start = 0; start < chunks.length; start += batchSize) {
      const batch = chunks.slice(start, start + batchSize);
      const { embeddings } = await embedMany({
        model: elmEmbeddingModel,
        values: batch.map((chunk) => chunk.text),
      });

      await vectorStore.upsert({
        indexName: wikiVectorIndexName,
        ids: batch.map((chunk) => chunk.id),
        vectors: embeddings,
        metadata: batch.map((chunk) => ({
          ...chunk.metadata,
          text: chunk.text,
        })),
      });

      console.log(`Ingested ${Math.min(start + batch.length, chunks.length)} / ${chunks.length} chunks.`);
    }

    console.log(`GitBook ingest complete: ${pageSummaries.length} pages, ${chunks.length} chunks.`);
    return { pages: pageSummaries.length, chunks: chunks.length };
  } finally {
    await vectorStore.disconnect();
  }
}

function isMain() {
  return process.argv[1] ? fileURLToPath(import.meta.url) === resolve(process.argv[1]) : false;
}

if (isMain()) {
  ingestGitBook().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
