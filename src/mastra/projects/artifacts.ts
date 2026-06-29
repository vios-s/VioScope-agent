import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { inflateSync } from 'node:zlib';
import { generateText } from 'ai';
import JSZip from 'jszip';
import { getUserByUsername } from '../db/users';
import { elmChatModel } from '../llm';
import { runtimeEnv } from '../runtime-config';
import { userDatastoreSlug } from '../users/datastore';
import type { ProjectArtifactInput, ProjectArtifactRecord, ProjectRecord } from '../db/projects';

export const maxProjectArtifactUploadBytes = 20 * 1024 * 1024;
const maxDigestChars = 18_000;
const maxZipEntries = 80;
const maxZipEntryBytes = maxProjectArtifactUploadBytes;
const maxZipExtractedBytes = 60 * 1024 * 1024;
const textExtensions = new Set(['.md', '.markdown', '.txt', '.tex', '.latex', '.rst', '.csv', '.json', '.yaml', '.yml']);
const uploadExtensions = new Set([...textExtensions, '.docx', '.pptx', '.pdf', '.zip']);

export type ProjectArtifactUploadDigest = {
  artifact: ProjectArtifactInput;
  digestSource: 'llm' | 'fallback';
  extractedChars: number;
  extractedFiles: string[];
};

function legacyUploadRoot(): string {
  const configuredUploadRoot = runtimeEnv('PROJECT_ARTIFACT_UPLOAD_DIR').trim();
  if (configuredUploadRoot) return resolve(configuredUploadRoot);

  const configuredDatastoreRoot = runtimeEnv('DATASTORE_DIR').trim();
  return configuredDatastoreRoot
    ? resolve(configuredDatastoreRoot, 'uploads', 'projects')
    : join(tmpdir(), 'vioscope-agent', 'uploads', 'projects');
}

function datastoreRoot(): string | null {
  const configured = runtimeEnv('DATASTORE_DIR').trim();
  return configured ? resolve(configured) : null;
}

function dateTimeFolder(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function projectStorageRoot(project: Pick<ProjectRecord, 'ownerUsername' | 'project'>): Promise<string> {
  const configuredUploadRoot = runtimeEnv('PROJECT_ARTIFACT_UPLOAD_DIR').trim();
  if (configuredUploadRoot) {
    return resolve(configuredUploadRoot, sanitizePathPart(project.ownerUsername), sanitizePathPart(project.project));
  }

  const root = datastoreRoot();
  if (!root) {
    return resolve(tmpdir(), 'vioscope-agent', 'uploads', 'projects', sanitizePathPart(project.ownerUsername), sanitizePathPart(project.project));
  }

  const owner = await getUserByUsername(project.ownerUsername).catch(() => null);
  const ownerSlug = owner ? userDatastoreSlug(owner) : sanitizePathPart(project.ownerUsername);
  return resolve(root, 'users', ownerSlug, 'projects', sanitizePathPart(project.project));
}

function sanitizeFileName(name: string): string {
  return (
    basename(name)
      .replace(/[/\\?%*:|"<>]/g, '-')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'artifact'
  );
}

function sanitizePathPart(value: string): string {
  return sanitizeFileName(value).toLowerCase() || 'unknown';
}

function assertInside(root: string, target: string) {
  const rel = relative(root, target);
  if (rel.startsWith('..') || rel === '' || isAbsolute(rel)) {
    throw new Error('Unsafe artifact path.');
  }
}

export async function assertStoredProjectArtifactPath(
  filePath: string | null | undefined,
  project?: Pick<ProjectRecord, 'ownerUsername' | 'project'>,
): Promise<string> {
  if (!filePath) throw new Error('Artifact has no stored file path.');
  const roots = [legacyUploadRoot()];
  if (project) roots.push(await projectStorageRoot(project));
  const target = resolve(filePath);
  for (const root of roots) {
    try {
      assertInside(root, target);
      return target;
    } catch {
      continue;
    }
  }
  throw new Error('Unsafe artifact path.');
}

export function projectArtifactKind(fileName: string): string {
  const ext = extname(fileName).toLowerCase();
  if (['.pptx', '.ppt', '.key'].includes(ext)) return 'slides';
  if (['.tex', '.bib'].includes(ext)) return 'latex';
  if (ext === '.zip') return 'zip';
  if (['.docx', '.pdf', '.md', '.markdown', '.txt', '.rst'].includes(ext)) return 'document';
  if (['.json', '.yaml', '.yml', '.csv'].includes(ext)) return 'data';
  return 'other';
}

function decodeXmlText(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function xmlTextRuns(xml: string, tag: 'w:t' | 'a:t'): string {
  const escapedTag = tag.replace(':', '\\:');
  const pattern = new RegExp(`<${escapedTag}[^>]*>([\\s\\S]*?)<\\/${escapedTag}>`, 'g');
  return Array.from(xml.matchAll(pattern), (match) => decodeXmlText(match[1] || '')).join(' ');
}

async function officeText(buffer: Buffer, fileName: string): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const ext = extname(fileName).toLowerCase();
  const parts: string[] = [];

  if (ext === '.docx') {
    for (const name of Object.keys(zip.files).filter((entry) => /^word\/(document|header|footer).*\.xml$/i.test(entry))) {
      parts.push(xmlTextRuns(await zip.files[name]!.async('text'), 'w:t'));
    }
  }

  if (ext === '.pptx') {
    for (const name of Object.keys(zip.files).filter((entry) => /^ppt\/(slides|notesSlides)\/.*\.xml$/i.test(entry))) {
      parts.push(xmlTextRuns(await zip.files[name]!.async('text'), 'a:t'));
    }
  }

  return parts.join('\n').replace(/\s+/g, ' ').trim();
}

function decodePdfLiteral(value: string): string {
  return value
    .replace(/\\([nrtbf()\\])/g, (_match, escaped: string) => {
      if (escaped === 'n') return '\n';
      if (escaped === 'r') return '\r';
      if (escaped === 't') return '\t';
      if (escaped === 'b') return '\b';
      if (escaped === 'f') return '\f';
      return escaped;
    })
    .replace(/\\([0-7]{1,3})/g, (_match, octal: string) => String.fromCharCode(Number.parseInt(octal, 8)));
}

function decodePdfHex(value: string): string {
  const clean = value.replace(/\s+/g, '');
  const bytes: number[] = [];
  for (let index = 0; index < clean.length; index += 2) {
    bytes.push(Number.parseInt(clean.slice(index, index + 2).padEnd(2, '0'), 16));
  }
  return Buffer.from(bytes).toString(bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf16le' : 'utf8');
}

function pdfTextFromContent(content: string): string {
  const literals = Array.from(content.matchAll(/\((?:\\.|[^\\)])*\)/g), (match) => decodePdfLiteral(match[0].slice(1, -1)));
  const hexStrings = Array.from(content.matchAll(/<([0-9a-fA-F\s]{4,})>/g), (match) => decodePdfHex(match[1] || ''));
  return [...literals, ...hexStrings].join(' ');
}

function pdfText(buffer: Buffer): string {
  const raw = buffer.toString('latin1');
  const parts = [pdfTextFromContent(raw)];
  const streamPattern = /<<(.*?)>>\s*stream\r?\n?([\s\S]*?)\r?\n?endstream/g;

  for (const match of raw.matchAll(streamPattern)) {
    const dictionary = match[1] || '';
    const streamBody = Buffer.from(match[2] || '', 'latin1');
    try {
      const decoded = /\/FlateDecode/.test(dictionary) ? inflateSync(streamBody).toString('latin1') : streamBody.toString('latin1');
      parts.push(pdfTextFromContent(decoded));
    } catch {
      parts.push(pdfTextFromContent(streamBody.toString('latin1')));
    }
  }

  return parts.join('\n').replace(/\s+/g, ' ').trim();
}

function safeArchivePath(name: string): string | null {
  const parts = name
    .split(/[\\/]+/)
    .map((part) => sanitizeFileName(part))
    .filter(Boolean);
  if (!parts.length || parts.some((part) => part === '..')) return null;
  return join(...parts);
}

async function zipText(buffer: Buffer, extractRoot: string): Promise<{ text: string; files: string[] }> {
  const zip = await JSZip.loadAsync(buffer);
  await mkdir(/* turbopackIgnore: true */ extractRoot, { recursive: true });
  const parts: string[] = [];
  const files: string[] = [];
  let extractedBytes = 0;

  for (const entry of Object.values(zip.files).slice(0, maxZipEntries)) {
    if (entry.dir) continue;
    const safePath = safeArchivePath(entry.name);
    if (!safePath) continue;
    const entrySize = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
    if (typeof entrySize === 'number' && entrySize > maxZipEntryBytes) {
      throw new Error('Zip entry is too large.');
    }
    const targetPath = resolve(extractRoot, safePath);
    assertInside(extractRoot, targetPath);
    await mkdir(/* turbopackIgnore: true */ resolve(targetPath, '..'), { recursive: true });
    const entryBuffer = await entry.async('nodebuffer');
    if (entryBuffer.byteLength > maxZipEntryBytes) {
      throw new Error('Zip entry is too large.');
    }
    extractedBytes += entryBuffer.byteLength;
    if (extractedBytes > maxZipExtractedBytes) {
      throw new Error('Zip archive expands beyond the 60 MB limit.');
    }
    await writeFile(/* turbopackIgnore: true */ targetPath, entryBuffer);
    files.push(safePath);

    const ext = extname(safePath).toLowerCase();
    if (textExtensions.has(ext)) {
      parts.push(`${safePath}:\n${entryBuffer.toString('utf8')}`);
    } else if (ext === '.docx' || ext === '.pptx') {
      parts.push(`${safePath}:\n${await officeText(entryBuffer, safePath)}`);
    } else if (ext === '.pdf') {
      parts.push(`${safePath}:\n${pdfText(entryBuffer)}`);
    }
  }

  return { text: parts.join('\n\n').slice(0, maxDigestChars), files };
}

async function extractText(buffer: Buffer, fileName: string, targetPath: string): Promise<{ text: string; files: string[] }> {
  const ext = extname(fileName).toLowerCase();
  if (textExtensions.has(ext)) {
    return { text: buffer.toString('utf8').slice(0, maxDigestChars), files: [sanitizeFileName(fileName)] };
  }
  if (ext === '.docx' || ext === '.pptx') {
    return { text: (await officeText(buffer, fileName)).slice(0, maxDigestChars), files: [sanitizeFileName(fileName)] };
  }
  if (ext === '.pdf') {
    return { text: pdfText(buffer).slice(0, maxDigestChars), files: [sanitizeFileName(fileName)] };
  }
  if (ext === '.zip') {
    return zipText(buffer, `${targetPath}.extracted`);
  }
  return { text: '', files: [sanitizeFileName(fileName)] };
}

function fallbackDigest(fileName: string, kind: string, text: string, files: string[]): string {
  const preview = text.replace(/\s+/g, ' ').trim().slice(0, 700);
  const fileList = files.length ? ` Extracted files: ${files.slice(0, 8).join(', ')}.` : '';
  return preview
    ? `Digest: ${fileName} (${kind}) covers ${preview}${preview.length >= 700 ? '...' : '.'}${fileList}`
    : `Digest: ${fileName} (${kind}) was uploaded.${fileList}`;
}

async function summarizeArtifact(fileName: string, kind: string, text: string, files: string[]) {
  const fallback = fallbackDigest(fileName, kind, text, files);
  if (!text.trim()) {
    return { summary: fallback, source: 'fallback' as const };
  }

  try {
    const result = await generateText({
      model: elmChatModel,
      system:
        'You summarize lab project artifacts for a project dashboard. Return 2 concise sentences. Do not invent details. Mention the likely artifact purpose and key contents.',
      prompt: `Artifact filename: ${fileName}\nArtifact kind: ${kind}\nExtracted files: ${files.join(', ') || 'none'}\n\nExtracted text:\n${text.slice(0, maxDigestChars)}`,
      maxOutputTokens: 180,
    });
    const summary = result.text.trim();
    return { summary: summary || fallback, source: summary ? ('llm' as const) : ('fallback' as const) };
  } catch {
    return { summary: fallback, source: 'fallback' as const };
  }
}

export async function saveProjectArtifactUpload(project: ProjectRecord, file: File): Promise<ProjectArtifactUploadDigest> {
  if (file.size <= 0) throw new Error('Artifact file is empty.');
  if (file.size > maxProjectArtifactUploadBytes) throw new Error('Artifact file is too large. Limit is 20 MB.');
  const ext = extname(file.name).toLowerCase();
  if (!uploadExtensions.has(ext)) {
    throw new Error(`Unsupported artifact extension "${ext || '(none)'}".`);
  }

  const projectDir = await projectStorageRoot(project);
  const uploadDir = resolve(projectDir, dateTimeFolder());
  await mkdir(/* turbopackIgnore: true */ uploadDir, { recursive: true });

  const storedName = `${Date.now()}-${sanitizeFileName(file.name)}`;
  const targetPath = resolve(uploadDir, storedName);
  assertInside(projectDir, targetPath);
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(/* turbopackIgnore: true */ targetPath, buffer);

  const extracted = await extractText(buffer, file.name, targetPath);
  const kind = projectArtifactKind(file.name);
  const digest = await summarizeArtifact(file.name, kind, extracted.text, extracted.files);

  return {
    artifact: {
      title: file.name,
      kind,
      path: targetPath,
      summary: digest.summary,
      artifactKey: sanitizeFileName(file.name).toLowerCase(),
    },
    digestSource: digest.source,
    extractedChars: extracted.text.length,
    extractedFiles: extracted.files,
  };
}

export async function digestStoredProjectArtifact(
  artifact: ProjectArtifactRecord,
  project?: Pick<ProjectRecord, 'ownerUsername' | 'project'>,
): Promise<ProjectArtifactUploadDigest> {
  const storedPath = await assertStoredProjectArtifactPath(artifact.path, project);
  const buffer = await readFile(/* turbopackIgnore: true */ storedPath);
  const extracted = await extractText(buffer, artifact.title, storedPath);
  const kind = projectArtifactKind(artifact.title);
  const digest = await summarizeArtifact(artifact.title, kind, extracted.text, extracted.files);

  return {
    artifact: {
      title: artifact.title,
      kind,
      path: storedPath,
      summary: digest.summary,
      artifactKey: artifact.artifactKey,
    },
    digestSource: digest.source,
    extractedChars: extracted.text.length,
    extractedFiles: extracted.files,
  };
}
