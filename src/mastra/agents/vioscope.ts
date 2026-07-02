import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { elmChatModel } from '../llm';
import { agentPrompt } from '../prompts';
import { logKbGapTool } from '../tools/log-kb-gap';
import { checkProjectProgressTool, getProjectDetailTool, listVisibleProjectsTool } from '../tools/projects';
import { submissionReviewTool } from '../tools/submission-review';
import { readThemeMeetingPlanTool, submitThemeMeetingUpdateTool } from '../tools/theme-meetings';
import { listViosSkillsTool, readViosSkillTool } from '../tools/vios-skills';
import { wikiSearchTool } from '../tools/wiki-search';

export const vioscopeAgent = new Agent({
  id: 'vioscope',
  name: 'VioScope',
  model: elmChatModel,
  instructions: agentPrompt.instructions,
  tools: {
    'search-wiki': wikiSearchTool,
    'log-kb-gap': logKbGapTool,
    'list-vios-skills': listViosSkillsTool,
    'read-vios-skill': readViosSkillTool,
    'run-submission-review': submissionReviewTool,
    'list-visible-projects': listVisibleProjectsTool,
    'get-project-detail': getProjectDetailTool,
    'check-project-progress': checkProjectProgressTool,
    'read-theme-meeting-plan': readThemeMeetingPlanTool,
    'submit-theme-meeting-update': submitThemeMeetingUpdateTool,
  },
  memory: new Memory(),
});
