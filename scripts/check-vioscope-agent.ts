import 'dotenv/config';
import { countKbGaps, deleteKbGapsBySessionPrefix, getLatestKbGap } from '../src/mastra/db/kb-gaps';
import { mastra } from '../src/mastra';
import { disconnectWikiSearchTool } from '../src/mastra/tools/wiki-search';

const supportedQuestion =
  process.env.VIOSCOPE_SMOKE_SUPPORTED_QUESTION || 'What EIDF resources or setup steps should I know?';
const unsupportedQuestion =
  process.env.VIOSCOPE_SMOKE_UNSUPPORTED_QUESTION || 'What is the VIOS lab policy for Project Nebula parking permits?';

type VioScopeToolName = 'search-wiki' | 'log-kb-gap';

function toolNameFromCall(toolCall: unknown): string | undefined {
  if (!toolCall || typeof toolCall !== 'object') {
    return undefined;
  }

  const maybeToolCall = toolCall as {
    toolName?: unknown;
    toolNameText?: unknown;
    name?: unknown;
    payload?: { toolName?: unknown };
  };
  const name = maybeToolCall.toolName || maybeToolCall.toolNameText || maybeToolCall.name || maybeToolCall.payload?.toolName;
  return typeof name === 'string' ? name : undefined;
}

async function runAgentCheck(
  label: string,
  question: string,
  forcedTool: VioScopeToolName,
  sessionPrefix: string,
): Promise<Set<string>> {
  const toolNames = new Set<string>();
  const agent = mastra.getAgent('vioscopeAgent');

  const response = await agent.generate(question, {
    maxSteps: 1,
    activeTools: [forcedTool],
    toolChoice: {
      type: 'tool',
      toolName: forcedTool,
    },
    memory: {
      thread: `${sessionPrefix}-${label}`,
      resource: 'local-smoke',
    },
  });

  for (const toolCall of response.toolCalls || []) {
    const name = toolNameFromCall(toolCall);
    if (name) {
      toolNames.add(name);
    }
  }

  for (const toolResult of response.toolResults || []) {
    const name = toolNameFromCall(toolResult);
    if (name) {
      toolNames.add(name);
    }
  }

  console.log(
    `${label}: finish_reason=${response.finishReason} forced_tool=${forcedTool} tools=${
      Array.from(toolNames).join(',') || 'none'
    }`,
  );
  return toolNames;
}

async function main() {
  const sessionPrefix = `local-smoke-${Date.now()}`;
  const gapCountBefore = await countKbGaps();

  try {
    const supportedTools = await runAgentCheck('supported', supportedQuestion, 'search-wiki', sessionPrefix);
    if (!supportedTools.has('search-wiki')) {
      throw new Error('Supported smoke check did not call search-wiki.');
    }

    const gapCountAfterSupported = await countKbGaps();
    const unsupportedTools = await runAgentCheck('unsupported', unsupportedQuestion, 'log-kb-gap', sessionPrefix);
    const gapCountAfterUnsupported = await countKbGaps();

    if (!unsupportedTools.has('log-kb-gap')) {
      throw new Error('Unsupported smoke check did not call log-kb-gap.');
    }

    if (gapCountAfterUnsupported <= gapCountAfterSupported) {
      throw new Error('Unsupported smoke check did not create a kb_gaps row.');
    }

    const latestGap = await getLatestKbGap();
    console.log(
      `VioScope agent check passed: gaps ${gapCountBefore} -> ${gapCountAfterUnsupported}, latest_gap_id=${
        latestGap?.id || 'unknown'
      }`,
    );
  } finally {
    const cleanedRows = await deleteKbGapsBySessionPrefix(sessionPrefix);
    if (cleanedRows > 0) {
      console.log(`Cleaned ${cleanedRows} smoke gap row(s).`);
    }
    await disconnectWikiSearchTool();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
