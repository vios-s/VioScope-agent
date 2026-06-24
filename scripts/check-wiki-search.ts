import 'dotenv/config';
import { disconnectWikiSearchTool, searchWiki } from '../src/mastra/tools/wiki-search';

async function main() {
  const query = process.argv.slice(2).join(' ') || 'induction';

  try {
    const results = await searchWiki(query, 5);

    console.log(`Wiki search check passed: ${results.relevantContext.length} result(s).`);

    for (const [index, result] of results.relevantContext.entries()) {
      console.log(
        `${index + 1}. score=${Number(result.score || 0).toFixed(4)} title=${result.page_title || 'unknown'} path=${
          result.page_path || 'unknown'
        } chunk=${result.chunk_index ?? 'unknown'}`,
      );
    }
  } finally {
    await disconnectWikiSearchTool();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
