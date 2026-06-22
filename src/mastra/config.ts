export const gitBookBaseURL = 'https://api.gitbook.com/v1';

export const wikiVectorIndexName = process.env.WIKI_VECTOR_INDEX || 'wiki_chunks';
export const wikiVectorDimension = Number.parseInt(process.env.WIKI_VECTOR_DIMENSION || '1536', 10);
export const wikiChunkSize = Number.parseInt(process.env.WIKI_CHUNK_SIZE || '3200', 10);
export const wikiChunkOverlap = Number.parseInt(process.env.WIKI_CHUNK_OVERLAP || '400', 10);

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.startsWith('replace-with-')) {
    throw new Error(`Missing ${name}. Set it in .env or the shell.`);
  }

  return value;
}
