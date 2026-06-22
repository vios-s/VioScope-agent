import { createOpenAI } from '@ai-sdk/openai';

const elmApiKey = process.env.ELM_API_KEY || 'replace-with-elm-api-key';
const defaultChatModel = 'gpt-5.4-nano-2026-03-17';
const defaultEmbeddingModel = 'text-embedding-3-small';

export const elm = createOpenAI({
  apiKey: elmApiKey,
});

export const elmChatModel = elm(process.env.ELM_CHAT_MODEL || defaultChatModel);
export const elmEmbeddingModel = elm.embedding(process.env.ELM_EMBED_MODEL || defaultEmbeddingModel);
