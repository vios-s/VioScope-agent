import { createTool } from '@mastra/core/tools';
import type { QueryResult } from '@mastra/core/vector';
import { embedMany } from 'ai';
import { z } from 'zod';
import { wikiVectorIndexName } from '../config';
import { elmEmbeddingModel } from '../llm';
import { runtimeEnvNumber } from '../runtime-config';
import { createWikiVectorStore } from '../vector';
import { matchesChatPolicyTerms, vioscopeChatPolicyConfig } from '../agents/vioscope.chat-policy.config';

const wikiVectorStore = createWikiVectorStore();

const wikiSearchInputSchema = z.object({
  queryText: z.string().trim().min(1).max(4000),
  topK: z.coerce.number().int().min(1).max(20).optional(),
}).passthrough();

const wikiSearchOutputSchema = z.object({
  relevantContext: z.array(z.record(z.string(), z.any())),
  sources: z.array(
    z.object({
      title: z.string(),
      url: z.string(),
      path: z.string().optional(),
      score: z.number().optional(),
      metadata: z.record(z.string(), z.any()).optional(),
    }),
  ),
});

type WikiSearchOutput = z.infer<typeof wikiSearchOutputSchema>;

export function shouldExpandWikiQuery(queryText: string): boolean {
  return matchesChatPolicyTerms(queryText, vioscopeChatPolicyConfig.practicalWikiQueryTerms);
}

function expandedWikiQueries(queryText: string): string[] {
  const query = queryText.replace(/\s+/g, ' ').trim();
  if (!shouldExpandWikiQuery(query)) {
    return [query];
  }

  return Array.from(new Set([query, `${query} ${vioscopeChatPolicyConfig.wikiQueryExpansionTerms.join(' ')}`]));
}

function resultKey(result: QueryResult): string {
  const metadata = result.metadata || {};
  return (
    result.id ||
    [metadata.page_id, metadata.page_path, metadata.chunk_index]
      .filter((value) => value !== undefined && value !== null)
      .join(':')
  );
}

function mergeResults(results: QueryResult[], topK: number): QueryResult[] {
  const byKey = new Map<string, QueryResult>();
  for (const result of results) {
    const key = resultKey(result);
    const existing = byKey.get(key);
    if (!existing || result.score > existing.score) {
      byKey.set(key, result);
    }
  }

  return Array.from(byKey.values())
    .sort((left, right) => right.score - left.score)
    .slice(0, topK);
}

function toSource(result: QueryResult) {
  const metadata = result.metadata || {};
  const title = typeof metadata.page_title === 'string' ? metadata.page_title : 'Source';
  const url = typeof metadata.url === 'string' ? metadata.url : '';
  const path = typeof metadata.page_path === 'string' ? metadata.page_path : undefined;
  return {
    title,
    url,
    path,
    score: result.score,
    metadata: { ...metadata, score: result.score },
  };
}

export async function searchWiki(queryText: string, topK = 10): Promise<WikiSearchOutput> {
  const queries = expandedWikiQueries(queryText);
  const { embeddings } = await embedMany({
    model: elmEmbeddingModel,
    values: queries,
  });
  const minScore = runtimeEnvNumber('WIKI_MIN_SCORE', 0.35);
  const results: QueryResult[] = [];

  for (const embedding of embeddings) {
    const nextResults = await wikiVectorStore.query({
      indexName: wikiVectorIndexName,
      queryVector: embedding,
      topK,
      includeVector: false,
      minScore,
    });
    results.push(...nextResults);
  }

  const mergedResults = mergeResults(results, topK);
  return {
    relevantContext: mergedResults.map((result) => ({ ...(result.metadata || {}), score: result.score })),
    sources: mergedResults.map(toSource).filter((source) => source.url),
  };
}

export const wikiSearchTool = createTool({
  id: 'search-wiki',
  description:
    'Search the VioScope GitBook knowledge base. Use this before answering wiki or lab knowledge questions, and cite returned source metadata.',
  inputSchema: wikiSearchInputSchema,
  outputSchema: wikiSearchOutputSchema,
  mcp: {
    annotations: {
      title: 'Search Wiki',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  execute: async (input) => {
    const topK = Number(input.topK || 10);
    return searchWiki(input.queryText, Number.isFinite(topK) ? topK : 10);
  },
  toModelOutput: (output) => ({
    type: 'text',
    value: output.relevantContext.length
      ? output.relevantContext
          .map((item, index) => {
            const title = typeof item.page_title === 'string' ? item.page_title : `Result ${index + 1}`;
            const url = typeof item.url === 'string' ? item.url : '';
            const text = typeof item.text === 'string' ? item.text : '';
            return `[${index + 1}] ${title}${url ? ` (${url})` : ''}\n${text}`;
          })
          .join('\n\n')
      : 'No relevant wiki context found.',
  }),
});

export async function disconnectWikiSearchTool() {
  await wikiVectorStore.disconnect();
}
