import { createOpenAI } from '@ai-sdk/openai';
import { runtimeEnv } from './runtime-config';

const elmApiKey = process.env.ELM_API_KEY || 'replace-with-elm-api-key';
const defaultChatModel = 'gpt-5.4-nano-2026-03-17';
const defaultEmbeddingModel = 'text-embedding-3-small';

export const elm = createOpenAI({
  apiKey: elmApiKey,
});

export const elmChatModel = elm(runtimeEnv('ELM_CHAT_MODEL', defaultChatModel));
export const elmEmbeddingModel = elm.embedding(runtimeEnv('ELM_EMBED_MODEL', defaultEmbeddingModel));
