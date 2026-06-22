import { wikiChunkOverlap, wikiChunkSize } from '../config';
import type { WikiChunk, WikiPage } from './types';

export function chunkWikiPage(page: WikiPage, spaceId: string): WikiChunk[] {
  const paragraphs = page.text
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = '';

  for (const paragraph of paragraphs) {
    if (!current) {
      current = paragraph;
      continue;
    }

    if (current.length + paragraph.length + 2 <= wikiChunkSize) {
      current = `${current}\n\n${paragraph}`;
      continue;
    }

    chunks.push(current);
    current = overlapTail(current, wikiChunkOverlap);
    current = current ? `${current}\n\n${paragraph}` : paragraph;
  }

  if (current) {
    chunks.push(current);
  }

  return chunks.map((text, index) => ({
    id: stableChunkId(page.id, index),
    text,
    metadata: {
      source: 'gitbook',
      space: spaceId,
      page_id: page.id,
      page_title: page.title,
      page_path: page.path,
      url: page.url,
      last_modified: page.updatedAt,
      chunk_index: index,
      confidentiality: 'private',
    },
  }));
}

function overlapTail(text: string, maxLength: number) {
  if (maxLength <= 0 || text.length <= maxLength) return text;

  const tail = text.slice(-maxLength);
  const boundary = tail.search(/\s/);
  return boundary > 0 ? tail.slice(boundary).trim() : tail.trim();
}

function stableChunkId(pageId: string, index: number) {
  return `gitbook:${pageId}:${index}`;
}
