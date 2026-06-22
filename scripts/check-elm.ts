import 'dotenv/config';

const required = ['ELM_API_KEY', 'ELM_CHAT_MODEL', 'ELM_EMBED_MODEL'] as const;
const openAIBaseURL = 'https://api.openai.com/v1';

function getEnv(name: (typeof required)[number]): string {
  const value = process.env[name];
  if (!value || value.startsWith('replace-with-')) {
    throw new Error(`Missing ${name}. Set it in .env or the shell before running this check.`);
  }

  return value;
}

function endpoint(baseURL: string, path: string): string {
  return `${baseURL.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

async function postJSON(url: string, apiKey: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

async function assertOK(label: string, response: Response): Promise<void> {
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${label} failed: HTTP ${response.status} ${response.statusText}\n${text}`);
  }
}

async function main() {
  const apiKey = getEnv('ELM_API_KEY');
  const chatModel = getEnv('ELM_CHAT_MODEL');
  const embedModel = getEnv('ELM_EMBED_MODEL');

  const chatResponse = await postJSON(endpoint(openAIBaseURL, '/chat/completions'), apiKey, {
    model: chatModel,
    messages: [
      {
        role: 'user',
        content: 'Reply with exactly: ok',
      },
    ],
    max_completion_tokens: 8,
  });
  await assertOK('ELM chat check', chatResponse);

  const embeddingResponse = await postJSON(endpoint(openAIBaseURL, '/embeddings'), apiKey, {
    model: embedModel,
    input: 'VioScope readiness check',
  });
  await assertOK('ELM embedding check', embeddingResponse);

  console.log('ELM chat and embedding checks passed.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
