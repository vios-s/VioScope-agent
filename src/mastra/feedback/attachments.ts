import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { runtimeEnv } from '../runtime-config';

export const maxFeedbackAttachmentBytes = 10 * 1024 * 1024;

const allowedTypes = new Map<string, string>([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
  ['.pdf', 'application/pdf'],
  ['.txt', 'text/plain'],
]);

export type StoredFeedbackAttachment = {
  name: string;
  mimeType: string;
  size: number;
  path: string;
};

function attachmentRoot(): string {
  const configured = runtimeEnv('FEEDBACK_UPLOAD_DIR').trim();
  if (configured) return resolve(configured);

  const datastore = runtimeEnv('DATASTORE_DIR').trim();
  return datastore ? resolve(datastore, 'runtime', 'feedback-uploads') : resolve('.local', 'feedback-uploads');
}

function safeFileName(name: string): string {
  return (
    basename(name)
      .replace(/[/\\?%*:|"<>]/g, '-')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 160) || 'attachment'
  );
}

function assertInside(root: string, target: string) {
  const rel = relative(root, target);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Unsafe feedback attachment path.');
}

export function validateFeedbackAttachment(file: File): { name: string; mimeType: string; size: number } {
  if (file.size <= 0) throw new Error('Attachment is empty.');
  if (file.size > maxFeedbackAttachmentBytes) throw new Error('Attachment is too large. Limit is 10 MB.');
  const name = safeFileName(file.name);
  const mimeType = allowedTypes.get(extname(name).toLowerCase());
  if (!mimeType) throw new Error('Attachments must be a PNG, JPEG, WebP, GIF, PDF, or text file.');
  return { name, mimeType, size: file.size };
}

export async function saveFeedbackAttachment(feedbackId: string, file: File): Promise<StoredFeedbackAttachment> {
  const attachment = validateFeedbackAttachment(file);
  const root = attachmentRoot();
  const folder = resolve(root, feedbackId);
  assertInside(root, folder);
  await mkdir(folder, { recursive: true });
  const path = resolve(folder, `${Date.now()}-${attachment.name}`);
  assertInside(root, path);
  await writeFile(/* turbopackIgnore: true */ path, Buffer.from(await file.arrayBuffer()));
  return { ...attachment, path };
}

export async function readFeedbackAttachment(path: string): Promise<Buffer> {
  const root = attachmentRoot();
  const target = resolve(path);
  assertInside(root, target);
  return readFile(/* turbopackIgnore: true */ target);
}
