import { gitBookBaseURL, requireEnv } from '../config';
import type { GitBookPage, GitBookPageSummary, GitBookRevision } from './types';

export class GitBookClient {
  private readonly token: string;
  private readonly spaceId: string;

  constructor({
    token = requireEnv('GITBOOK_TOKEN'),
    spaceId = requireEnv('GITBOOK_SPACE'),
  }: {
    token?: string;
    spaceId?: string;
  } = {}) {
    this.token = token;
    this.spaceId = spaceId;
  }

  get space() {
    return this.spaceId;
  }

  async getCurrentRevision() {
    return this.get<GitBookRevision>(`/spaces/${this.spaceId}/content`);
  }

  async getPage(pageId: string) {
    return this.get<GitBookPage>(`/spaces/${this.spaceId}/content/page/${pageId}`);
  }

  async listPages() {
    const revision = await this.getCurrentRevision();
    return flattenPages(revision.pages || []);
  }

  private async get<T>(path: string): Promise<T> {
    const response = await fetch(`${gitBookBaseURL}${path}`, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`GitBook API failed: HTTP ${response.status} ${response.statusText}\n${text}`);
    }

    return (await response.json()) as T;
  }
}

export function flattenPages(pages: GitBookPageSummary[]): GitBookPageSummary[] {
  const flattened: GitBookPageSummary[] = [];

  for (const page of pages) {
    flattened.push(page);
    if (page.pages?.length) {
      flattened.push(...flattenPages(page.pages));
    }
  }

  return flattened;
}
