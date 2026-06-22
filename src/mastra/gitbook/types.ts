export interface GitBookRevision {
  id: string;
  object?: string;
  pages?: GitBookPageSummary[];
}

export interface GitBookPageSummary {
  id: string;
  title?: string;
  path?: string;
  slug?: string;
  type?: string;
  kind?: string;
  urls?: Record<string, string>;
  pages?: GitBookPageSummary[];
  updatedAt?: string;
  createdAt?: string;
}

export interface GitBookPage extends GitBookPageSummary {
  document?: GitBookDocumentNode;
}

export interface GitBookDocumentNode {
  object?: string;
  type?: string;
  text?: string;
  data?: Record<string, unknown>;
  marks?: GitBookDocumentNode[];
  leaves?: GitBookDocumentNode[];
  nodes?: GitBookDocumentNode[];
  [key: string]: unknown;
}

export interface WikiPage {
  id: string;
  title: string;
  path: string;
  url?: string;
  updatedAt?: string;
  text: string;
}

export interface WikiChunk {
  id: string;
  text: string;
  metadata: {
    source: 'gitbook';
    space: string;
    page_id: string;
    page_title: string;
    page_path: string;
    url?: string;
    last_modified?: string;
    chunk_index: number;
    confidentiality: 'private';
  };
}
