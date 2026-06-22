import 'dotenv/config';
import { wikiVectorIndexName } from '../src/mastra/config';
import { createWikiVectorStore } from '../src/mastra/vector';

async function main() {
  const vectorStore = createWikiVectorStore();

  try {
    await vectorStore.deleteIndex({ indexName: wikiVectorIndexName });
    console.log(`Deleted wiki vector index/table: ${wikiVectorIndexName}`);
  } finally {
    await vectorStore.disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
