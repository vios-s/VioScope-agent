import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { logKbGap } from '../db/kb-gaps';

export const logKbGapTool = createTool({
  id: 'log-kb-gap',
  description:
    'Record a VioScope knowledge-base gap when the wiki search results do not support an answer. Use only for lab/wiki questions that cannot be answered from available sources.',
  inputSchema: z.object({
    question: z.string().trim().min(1).max(4000).describe('The original user question that could not be answered.'),
    source: z.string().trim().min(1).max(80).default('wiki_qa').describe('Gap source category.'),
    sessionId: z.string().trim().min(1).max(200).optional().describe('Optional caller-provided session id.'),
  }),
  outputSchema: z.object({
    recorded: z.literal(true),
    gapId: z.string(),
    source: z.string(),
    sessionId: z.string().nullable(),
    createdAt: z.string(),
  }),
  mcp: {
    annotations: {
      title: 'Log Knowledge Gap',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  execute: async ({ question, source, sessionId }, context) => {
    const record = await logKbGap({
      question,
      source,
      sessionId: sessionId || context.agent?.threadId,
    });

    return {
      recorded: true as const,
      gapId: record.id,
      source: record.source,
      sessionId: record.sessionId,
      createdAt: record.createdAt,
    };
  },
  toModelOutput: (output) => ({
    type: 'text',
    value: `Knowledge-base gap recorded as ${output.gapId}.`,
  }),
});
