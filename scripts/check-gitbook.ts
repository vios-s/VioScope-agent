import 'dotenv/config';

const gitBookBaseURL = 'https://api.gitbook.com/v1';

function getEnv(name: 'GITBOOK_TOKEN' | 'GITBOOK_SPACE'): string {
  const value = process.env[name];
  if (!value || value.startsWith('replace-with-')) {
    throw new Error(`Missing ${name}. Set it in .env or the shell before running this check.`);
  }

  return value;
}

async function getJSON<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`${gitBookBaseURL}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitBook check failed: HTTP ${response.status} ${response.statusText}\n${text}`);
  }

  return (await response.json()) as T;
}

async function main() {
  const token = getEnv('GITBOOK_TOKEN');
  const spaceId = getEnv('GITBOOK_SPACE');

  const space = await getJSON<{
    id?: string;
    visibility?: string;
    organization?: string;
    urls?: { published?: string };
  }>(`/spaces/${spaceId}`, token);

  const content = await getJSON<{
    id?: string;
    object?: string;
    pages?: unknown[];
  }>(`/spaces/${spaceId}/content`, token);

  if (space.id !== spaceId) {
    throw new Error('GitBook check failed: returned space id did not match GITBOOK_SPACE.');
  }

  console.log('GitBook space and content checks passed.');
  console.log(`visibility=${space.visibility || 'unknown'}`);
  console.log(`has_organization_id=${Boolean(space.organization)}`);
  console.log(`has_published_url=${Boolean(space.urls?.published)}`);
  console.log(`content_object=${content.object || 'unknown'}`);
  console.log(`top_level_pages=${Array.isArray(content.pages) ? content.pages.length : 'unknown'}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
