import { createVectorQueryTool } from '@mastra/rag';
import { wikiVectorIndexName } from '../config';
import { elmEmbeddingModel } from '../llm';
import { runtimeEnvNumber } from '../runtime-config';
import { createWikiVectorStore } from '../vector';

const wikiVectorStore = createWikiVectorStore();

export const wikiSearchTool = createVectorQueryTool({
  id: 'search-wiki',
  description:
    'Search the VioScope GitBook knowledge base. Use this before answering wiki or lab knowledge questions, and cite returned source metadata.',
  vectorStore: wikiVectorStore,
  indexName: wikiVectorIndexName,
  model: elmEmbeddingModel,
  includeSources: true,
  databaseConfig: {
    pgvector: {
      minScore: runtimeEnvNumber('WIKI_MIN_SCORE', 0.35),
    },
  },
});

export async function disconnectWikiSearchTool() {
  await wikiVectorStore.disconnect();
}
