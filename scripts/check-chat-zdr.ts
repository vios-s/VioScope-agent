import { readFileSync } from 'node:fs';

const source = readFileSync('app/api/chat/route.ts', 'utf8');
const uiSource = readFileSync('app/operations-console.tsx', 'utf8');
const iconSource = readFileSync('app/dot-matrix-icon.tsx', 'utf8');
const agentPromptSource = readFileSync('src/mastra/prompts/agent.yaml', 'utf8');
const uiCopyPromptSource = readFileSync('src/mastra/prompts/ui-copy.yaml', 'utf8');
const chatPolicySource = readFileSync('src/mastra/agents/vioscope.chat-policy.config.ts', 'utf8');
const chatUiConfigSource = readFileSync('src/mastra/agents/vioscope.chat-ui.config.ts', 'utf8');
const checks = [
  ['disables OpenAI response storage', /store:\s*false/.test(source)],
  ['detects ZDR persistence errors', /Items are not persisted for Zero Data Retention/.test(source)],
  ['detects missing item references', /Item with id \.\* not found/.test(source)],
  [
    'retries without thread memory',
    /isZdrItemReferenceError\(error\)/.test(source) &&
      /responseThreadId\s*=\s*`web-\$\{randomUUID\(\)\}`/.test(source) &&
      !/memory:\s*\{/.test(source) && /context: history/.test(source),
  ],
  ['checks session access before generating', source.indexOf('chatSessionAccess(threadId') > 0 && source.indexOf('chatSessionAccess(threadId') < source.indexOf('agent.generate(')],
  ['uses random thread ids', !/web-\$\{Date\.now\(\)\}/.test(source) && !/web-\$\{Date\.now\(\)\}/.test(uiSource)],
  ['never echoes internal errors', /The assistant could not answer this message/.test(source)],
  ['includes user context', /messageWithUserContext\(message,\s*user,\s*userDatastoreContext/.test(source)],
  ['blocks obvious out-of-scope chat', /isClearlyOutOfScope\(message\)/.test(source)],
  ['keeps chat scope policy in config', /labScopeTerms/.test(chatPolicySource) && /annual leave/.test(chatPolicySource)],
  ['keeps starter prompts in prompt yaml', /starterPrompts/.test(uiCopyPromptSource) && !/const prompts/.test(uiSource) && !/starterPrompts/.test(chatUiConfigSource)],
  ['loads user datastore context', /loadUserDatastoreContext\(user\)/.test(source)],
  ['states lab-only scope in agent prompt', /VioScope only helps with VIOS lab work/.test(agentPromptSource)],
  ['searches wiki before rejecting local procedure questions', /Search the wiki before deciding they are out of scope/.test(agentPromptSource)],
  ['returns source links', /const sources = answerSources\(response\.text, mergeSources\(extractSources\(response\.toolResults \|\| \[\]\)/.test(source)],
  ['keeps chat history', /useState<ChatMessage\[\]>\(\[\]\)/.test(uiSource)],
  ['stores local chat sessions', /window\.localStorage\.setItem/.test(uiSource)],
  ['renders markdown answers', /function MarkdownText/.test(uiSource)],
  ['keeps chat scrollable', /scrollRef/.test(uiSource)],
  ['uses dot matrix icon component', /export function DotMatrixIcon/.test(iconSource)],
] as const;

for (const [label, ok] of checks) {
  if (!ok) {
    throw new Error(`Chat ZDR check failed: ${label}.`);
  }
}

console.log('Chat ZDR check passed.');
