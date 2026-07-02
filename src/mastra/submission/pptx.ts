import { readFile } from 'node:fs/promises';
import { posix as pathPosix } from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import JSZip from 'jszip';

export type ExtractedSlide = {
  number: number;
  text: string[];
  notes: string[];
};

export type ExtractedPptx = {
  slides: ExtractedSlide[];
  text: string;
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  trimValues: true,
});

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function collectTextNodes(value: unknown, output: string[] = [], inTextRun = false): string[] {
  if (typeof value === 'string') {
    const text = inTextRun ? value.trim() : '';
    if (text) {
      output.push(text);
    }
    return output;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectTextNodes(item, output, inTextRun);
    }
    return output;
  }

  if (!value || typeof value !== 'object') {
    return output;
  }

  for (const [key, child] of Object.entries(value)) {
    if (key.startsWith('@_')) continue;
    collectTextNodes(child, output, inTextRun || key === 'a:t');
  }

  return output;
}

function dedupeConsecutive(lines: string[]): string[] {
  const result: string[] = [];

  for (const line of lines.map((item) => item.trim()).filter(Boolean)) {
    if (result[result.length - 1] !== line) {
      result.push(line);
    }
  }

  return result;
}

function slideNumberFromPath(path: string): number {
  const match = /slide(\d+)\.xml$/.exec(path);
  return match ? Number.parseInt(match[1], 10) : Number.MAX_SAFE_INTEGER;
}

function sortedSlidePaths(zip: JSZip): string[] {
  return Object.keys(zip.files)
    .filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
    .sort((a, b) => slideNumberFromPath(a) - slideNumberFromPath(b));
}

function relationshipArray(parsedRelationships: unknown): Array<Record<string, string>> {
  if (!parsedRelationships || typeof parsedRelationships !== 'object') {
    return [];
  }

  const root = parsedRelationships as { Relationships?: { Relationship?: unknown } };
  return asArray(root.Relationships?.Relationship).filter(
    (relationship): relationship is Record<string, string> =>
      Boolean(relationship) && typeof relationship === 'object',
  );
}

async function readXml(zip: JSZip, path: string): Promise<unknown | undefined> {
  const file = zip.file(path);
  if (!file) {
    return undefined;
  }

  return parser.parse(await file.async('text'));
}

async function notesPathForSlide(zip: JSZip, slidePath: string): Promise<string | undefined> {
  const slideDir = pathPosix.dirname(slidePath);
  const relsPath = pathPosix.join(slideDir, '_rels', `${pathPosix.basename(slidePath)}.rels`);
  const relationships = relationshipArray(await readXml(zip, relsPath));
  const notesRelationship = relationships.find((relationship) => relationship['@_Type']?.endsWith('/notesSlide'));
  const target = notesRelationship?.['@_Target'];

  if (!target) {
    return undefined;
  }

  return pathPosix.normalize(pathPosix.join(slideDir, target));
}

function renderDeck(name: string, slides: ExtractedSlide[]): string {
  const sections = slides.map((slide) => {
    const lines = [`## Slide ${slide.number}`];

    if (slide.text.length) {
      lines.push('', '### Slide Text', ...slide.text.map((text) => `- ${text}`));
    } else {
      lines.push('', '### Slide Text', '- (no extractable slide text)');
    }

    if (slide.notes.length) {
      lines.push('', '### Speaker Notes', ...slide.notes.map((text) => `- ${text}`));
    }

    return lines.join('\n');
  });

  return [`# PowerPoint Deck: ${name}`, '', ...sections].join('\n\n');
}

export async function extractPptxBuffer(buffer: Buffer, name: string): Promise<ExtractedPptx> {
  const zip = await JSZip.loadAsync(buffer);
  const slides: ExtractedSlide[] = [];

  for (const slidePath of sortedSlidePaths(zip)) {
    const parsedSlide = await readXml(zip, slidePath);
    const notesPath = await notesPathForSlide(zip, slidePath);
    const parsedNotes = notesPath ? await readXml(zip, notesPath) : undefined;

    slides.push({
      number: slideNumberFromPath(slidePath),
      text: dedupeConsecutive(collectTextNodes(parsedSlide)),
      notes: dedupeConsecutive(collectTextNodes(parsedNotes)),
    });
  }

  if (!slides.length) {
    throw new Error('No slides were found in the .pptx file.');
  }

  return {
    slides,
    text: renderDeck(name, slides),
  };
}

export async function extractPptx(path: string): Promise<ExtractedPptx> {
  return extractPptxBuffer(await readFile(path), path);
}
