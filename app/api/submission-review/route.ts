import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { NextResponse } from 'next/server';
import { AuthError, requireSessionUser } from '../../../src/mastra/auth/session';
import { defaultSubmissionReviewSkills, reviewSubmission } from '../../../src/mastra/submission/review';

export const runtime = 'nodejs';
export const maxDuration = 180;

const uploadRoot = resolve(
  /* turbopackIgnore: true */ process.env.SUBMISSION_REVIEW_UPLOAD_DIR ||
    (process.env.DATASTORE_DIR
      ? join(process.env.DATASTORE_DIR, 'uploads', 'submission-review')
      : join(tmpdir(), 'vioscope-agent', 'uploads', 'submission-review')),
);
const allowedUploadExtensions = new Set(['.md', '.markdown', '.txt', '.tex', '.latex', '.rst', '.pptx']);

function valueFromForm(formData: FormData, key: string): string | undefined {
  const value = formData.get(key);
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberFromForm(formData: FormData, key: string): number | undefined {
  const value = valueFromForm(formData, key);
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function maxOutputTokensFromForm(formData: FormData): number | undefined {
  const value = numberFromForm(formData, 'maxOutputTokens');
  return value ? Math.max(value, 2500) : undefined;
}

function skillNamesFromForm(formData: FormData): string[] | undefined {
  const selected = formData
    .getAll('skills')
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter(Boolean);

  return selected.length ? selected : [...defaultSubmissionReviewSkills];
}

function sanitizeFileName(name: string): string {
  const safe = name
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return safe || 'submission-draft';
}

async function saveUploadedDraft(file: File): Promise<string> {
  const extension = extname(file.name).toLowerCase();
  if (!allowedUploadExtensions.has(extension)) {
    throw new Error(`Unsupported file extension "${extension || '(none)'}".`);
  }

  await mkdir(uploadRoot, { recursive: true });
  const fileName = `${Date.now()}-${sanitizeFileName(file.name)}`;
  const targetPath = resolve(uploadRoot, fileName);
  await writeFile(targetPath, Buffer.from(await file.arrayBuffer()));
  return targetPath;
}

export async function POST(request: Request) {
  try {
    await requireSessionUser(request);
    const formData = await request.formData();
    const uploaded = formData.get('draftFile');
    const draftText = valueFromForm(formData, 'draftText');
    let draftPath: string | undefined;

    if (uploaded instanceof File && uploaded.size > 0) {
      draftPath = await saveUploadedDraft(uploaded);
    }

    if (!draftPath && !draftText) {
      return NextResponse.json({ error: 'Upload a supported draft/deck or paste draft text.' }, { status: 400 });
    }

    const result = await reviewSubmission({
      draftPath,
      draftText,
      draftName: draftPath ? uploaded instanceof File ? uploaded.name : undefined : valueFromForm(formData, 'draftName'),
      skills: skillNamesFromForm(formData),
      targetVenue: valueFromForm(formData, 'targetVenue'),
      deadline: valueFromForm(formData, 'deadline'),
      maxDraftChars: numberFromForm(formData, 'maxDraftChars'),
      maxOutputTokens: maxOutputTokensFromForm(formData),
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Submission review failed.';
    return NextResponse.json({ error: message }, { status: error instanceof AuthError ? error.status : 500 });
  }
}
