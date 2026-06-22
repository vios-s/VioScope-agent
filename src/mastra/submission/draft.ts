import { readFile, stat } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { extractPptx } from './pptx';

export type DraftSource = {
  name: string;
  text: string;
};

const supportedDraftExtensions = new Set(['.txt', '.md', '.markdown', '.tex', '.latex', '.rst']);
const maxDraftBytes = 2 * 1024 * 1024;
const maxDeckBytes = Number.parseInt(process.env.SUBMISSION_REVIEW_MAX_DECK_BYTES || `${25 * 1024 * 1024}`, 10);

export function supportedDraftExtensionList() {
  return [...supportedDraftExtensions, '.pptx'].sort().join(', ');
}

function isInside(parent: string, child: string): boolean {
  const normalizedParent = resolve(parent);
  const normalizedChild = resolve(child);
  return normalizedChild === normalizedParent || normalizedChild.startsWith(`${normalizedParent}/`);
}

export async function readDraftFile(path: string): Promise<DraftSource> {
  const resolvedPath = resolve(/* turbopackIgnore: true */ process.cwd(), path);
  const extension = extname(resolvedPath).toLowerCase();

  if (extension === '.pdf') {
    throw new Error('PDF review is not supported yet. Export or paste the draft as .md, .txt, or .tex first.');
  }

  if (extension === '.ppt' || extension === '.pptm') {
    throw new Error('Only .pptx PowerPoint files are supported in v1. Export legacy .ppt/.pptm decks to .pptx first.');
  }

  if (!supportedDraftExtensions.has(extension) && extension !== '.pptx') {
    throw new Error(`Unsupported draft extension "${extension || '(none)'}". Supported: ${supportedDraftExtensionList()}`);
  }

  const datastoreDir = process.env.DATASTORE_DIR
    ? resolve(/* turbopackIgnore: true */ process.cwd(), process.env.DATASTORE_DIR)
    : undefined;
  const allowedRoots = [process.cwd(), datastoreDir].filter((root): root is string => Boolean(root));
  const allowed = allowedRoots.some((root) => isInside(root, resolvedPath));

  if (!allowed) {
    throw new Error('Draft path must be inside the repository workspace or DATASTORE_DIR.');
  }

  const metadata = await stat(resolvedPath);
  if (!metadata.isFile()) {
    throw new Error(`Draft path is not a file: ${path}`);
  }

  if (extension === '.pptx') {
    if (metadata.size > maxDeckBytes) {
      throw new Error(`PowerPoint file is too large for the v1 harness (${metadata.size} bytes > ${maxDeckBytes} bytes).`);
    }

    const deck = await extractPptx(resolvedPath);
    return {
      name: path,
      text: deck.text,
    };
  }

  if (metadata.size > maxDraftBytes) {
    throw new Error(`Draft file is too large for the v1 harness (${metadata.size} bytes > ${maxDraftBytes} bytes).`);
  }

  return {
    name: path,
    text: await readFile(resolvedPath, 'utf8'),
  };
}
