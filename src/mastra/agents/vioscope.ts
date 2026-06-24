import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { elmChatModel } from '../llm';
import { readLabStateTool, summarizeThemeMeetingTool } from '../tools/lab-state';
import { logKbGapTool } from '../tools/log-kb-gap';
import { checkProjectProgressTool, getProjectDetailTool, listVisibleProjectsTool } from '../tools/projects';
import { submissionReviewTool } from '../tools/submission-review';
import { readThemeMeetingPlanTool, submitThemeMeetingUpdateTool } from '../tools/theme-meetings';
import { listViosSkillsTool, readViosSkillTool } from '../tools/vios-skills';
import { wikiSearchTool } from '../tools/wiki-search';

const promptSchema = z.object({
  instructions: z.string().trim().min(1),
});

function loadVioScopePrompt() {
  const promptPath = fileURLToPath(new URL('./vioscope.prompt.yaml', import.meta.url));
  return promptSchema.parse(parseYaml(readFileSync(promptPath, 'utf8')));
}

const vioscopePrompt = loadVioScopePrompt();

export const vioscopeAgent = new Agent({
  id: 'vioscope',
  name: 'VioScope',
  model: elmChatModel,
  instructions: vioscopePrompt.instructions,
  tools: {
    'search-wiki': wikiSearchTool,
    'log-kb-gap': logKbGapTool,
    'list-vios-skills': listViosSkillsTool,
    'read-vios-skill': readViosSkillTool,
    'run-submission-review': submissionReviewTool,
    'list-visible-projects': listVisibleProjectsTool,
    'get-project-detail': getProjectDetailTool,
    'check-project-progress': checkProjectProgressTool,
    'read-lab-state': readLabStateTool,
    'summarize-theme-meeting': summarizeThemeMeetingTool,
    'read-theme-meeting-plan': readThemeMeetingPlanTool,
    'submit-theme-meeting-update': submitThemeMeetingUpdateTool,
  },
  memory: new Memory(),
});
