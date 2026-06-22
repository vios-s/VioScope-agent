import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { renderThemeMeetingSummary, summarizeLabState } from '../state/derive';
import { filterLabState, readLabState } from '../state/loader';
import {
  type DerivedLabState,
  type LabStateSummary,
  derivedLabStateSchema,
  labStateSummarySchema,
  projectRecommendationSchema,
  projectStatusSchema,
} from '../state/schema';

const labStateInputSchema = z.object({
  statePath: z.string().trim().min(1).optional().describe('Optional path to lab-state.yaml or a project-state directory.'),
  owner: z.string().trim().min(1).optional(),
  status: projectStatusSchema.optional(),
  recommendation: projectRecommendationSchema.optional(),
});

export const readLabStateTool = createTool({
  id: 'read-lab-state',
  description:
    'Read and derive the VIOS A2 lab state model from DATASTORE_DIR or an explicit statePath. Use for project status, owner, stage, freshness, blocker, and recommendation questions.',
  inputSchema: labStateInputSchema,
  outputSchema: z.object({
    statePath: z.string(),
    loadedAt: z.string(),
    state: derivedLabStateSchema,
    summary: labStateSummarySchema,
  }),
  mcp: {
    annotations: {
      title: 'Read Lab State',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  execute: async (input) => {
    const { path, state } = await readLabState({ statePath: input.statePath });
    const filteredState = filterLabState(state, input);
    return {
      statePath: path,
      loadedAt: new Date().toISOString(),
      state: filteredState,
      summary: summarizeLabState(filteredState),
    };
  },
  toModelOutput: (output) => ({
    type: 'text',
    value: renderThemeMeetingSummary(output.state as DerivedLabState, output.summary as LabStateSummary),
  }),
});

export const summarizeThemeMeetingTool = createTool({
  id: 'summarize-theme-meeting',
  description:
    'Summarize the derived A2 lab state for theme-meeting preparation, including projects that need a nudge or deep dive.',
  inputSchema: labStateInputSchema,
  outputSchema: z.object({
    statePath: z.string(),
    loadedAt: z.string(),
    markdown: z.string(),
    summary: labStateSummarySchema,
  }),
  mcp: {
    annotations: {
      title: 'Summarize Theme Meeting',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  execute: async (input) => {
    const { path, state } = await readLabState({ statePath: input.statePath });
    const filteredState = filterLabState(state, input);
    const summary = summarizeLabState(filteredState);
    return {
      statePath: path,
      loadedAt: new Date().toISOString(),
      markdown: renderThemeMeetingSummary(filteredState, summary),
      summary,
    };
  },
  toModelOutput: (output) => ({
    type: 'text',
    value: output.markdown,
  }),
});
