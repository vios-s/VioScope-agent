import 'dotenv/config';
import { embed } from 'ai';
import { wikiVectorIndexName } from '../src/mastra/config';
import { elmEmbeddingModel } from '../src/mastra/llm';
import { runtimeEnvNumber } from '../src/mastra/runtime-config';
import { createWikiVectorStore } from '../src/mastra/vector';

async function main() {
  const query = process.argv.slice(2).join(' ') || 'induction';
  const vectorStore = createWikiVectorStore();

  try {
    const { embedding } = await embed({
      model: elmEmbeddingModel,
      value: query,
    });

    const results = await vectorStore.query({
      indexName: wikiVectorIndexName,
      queryVector: embedding,
      topK: 5,
      includeVector: false,
      minScore: runtimeEnvNumber('WIKI_MIN_SCORE', 0.35),
    });

    console.log(`Wiki search check passed: ${results.length} result(s).`);

    for (const [index, result] of results.entries()) {
      const metadata = result.metadata || {};
      console.log(
        `${index + 1}. score=${result.score.toFixed(4)} title=${metadata.page_title || 'unknown'} path=${
          metadata.page_path || 'unknown'
        } chunk=${metadata.chunk_index ?? 'unknown'}`,
      );
    }
  } finally {
    await vectorStore.disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
