import { readFileSync } from 'node:fs';

const source = readFileSync('app/api/chat/route.ts', 'utf8');
const uiSource = readFileSync('app/operations-console.tsx', 'utf8');
const iconSource = readFileSync('app/dot-matrix-icon.tsx', 'utf8');
const agentPromptSource = readFileSync('src/mastra/agents/vioscope.prompt.yaml', 'utf8');
const checks = [
  ['disables OpenAI response storage', /store:\s*false/.test(source)],
  ['detects ZDR persistence errors', /Items are not persisted for Zero Data Retention/.test(source)],
  ['detects missing item references', /Item with id \.\* not found/.test(source)],
  [
    'retries without thread memory',
    /isZdrItemReferenceError\(error\)/.test(source) &&
      /responseThreadId\s*=\s*`web-\$\{Date\.now\(\)\}`/.test(source) &&
      /response\s*=\s*await agent\.generate\(agentMessage,[\s\S]*?requestContext,[\s\S]*?\);/.test(source),
  ],
  ['includes user context', /messageWithUserContext\(message,\s*user,\s*userDatastoreContext\)/.test(source)],
  ['blocks obvious out-of-scope chat', /isClearlyOutOfScope\(message\)/.test(source)],
  ['allows leave-like wiki questions through RAG', /annual leave/.test(source) && /return false/.test(source)],
  ['loads user datastore context', /loadUserDatastoreContext\(user\)/.test(source)],
  ['states lab-only scope in agent prompt', /VioScope only helps with VIOS lab work/.test(agentPromptSource)],
  ['searches wiki before rejecting local procedure questions', /Search the wiki before deciding they are out of scope/.test(agentPromptSource)],
  ['returns source links', /const sources = extractSources\(response\.toolResults \|\| \[\]\)/.test(source)],
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
