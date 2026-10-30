import 'dotenv/config';
import { extname } from 'node:path';
import { z } from 'zod';
import { NextResponse } from 'next/server';
import { AuthError, requireSessionUser } from '../../../src/mastra/auth/session';
import { errorResponse } from '../../../src/mastra/http/error-response';
import { getProjectForUser } from '../../../src/mastra/db/projects';
import { listSkeletonReviews, saveSkeletonReview } from '../../../src/mastra/db/skeleton-reviews';
import { recordAuditLog } from '../../../src/mastra/db/audit-log';
import { withDatabaseTransaction } from '../../../src/mastra/db/postgres';
import { assertSkeletonStage, skeletonProjectSnapshot } from '../../../src/mastra/submission/skeleton-record';
import { renderSkeletonDraft, skeletonDraftSchema } from '../../../src/mastra/submission/skeleton';
import { extractPptxBuffer } from '../../../src/mastra/submission/pptx';
import { reviewSubmission } from '../../../src/mastra/submission/review';
import { extractDocumentText } from '../../../src/mastra/projects/idea-import';
import { readSkeletonFigures, readSkeletonForm } from '../../../src/mastra/submission/skeleton-figure-upload';
export const runtime = 'nodejs';
export const maxDuration = 180;
export async function GET(request: Request) {
  try { return NextResponse.json(await listSkeletonReviews(await requireSessionUser(request))); }
  catch (error) { return errorResponse(error, 400); }
}
export async function POST(request: Request) {
  try {
    const user = await requireSessionUser(request);
    const form = await readSkeletonForm(request);
    const projectId = z.string().uuid('Choose an active project.').parse(form.get('projectId'));
    const project = await getProjectForUser(projectId, user);
    if (!project.access.canEdit) throw new AuthError('Only the project owner, PI or administrator can request a check.', 403, 'forbidden');
    if (project.lifecycle !== 'active') throw new Error('Choose an active project.');
    assertSkeletonStage(project);
    const mode = z.enum(['blocks','paste','upload']).parse(form.get('mode'));
    const figures = await readSkeletonFigures(form, mode);
    let text = '';
    if (mode === 'blocks') {
      const blocks = skeletonDraftSchema.parse(JSON.parse(String(form.get('blocks'))));
      text = renderSkeletonDraft(blocks, figures);
    }
    if (mode === 'paste') text = z.string().trim().min(1, 'Paste the outline or draft before checking.').max(55000, 'The pasted text exceeds 55,000 characters. Shorten it or upload the document instead; content is never silently truncated.').parse(form.get('text'));
    if (mode === 'upload') {
      const file = form.get('file');
      if (!(file instanceof File) || !file.size) throw new Error('Choose a non-empty draft or deck.');
      const extension = extname(file.name).toLowerCase();
      if (!['.txt','.md','.markdown','.tex','.latex','.rst','.pptx','.docx','.pdf'].includes(extension)) throw new Error('Upload TXT, Markdown, LaTeX, RST, DOCX, text-based PDF or PPTX.');
      if (extension === '.docx' || extension === '.pdf') text = await extractDocumentText(file);
      else {
        if (file.size > (extension === '.pptx' ? 25 : 2) * 1024 * 1024) throw new Error('The uploaded file exceeds the supported size.');
        const buffer = Buffer.from(await file.arrayBuffer());
        text = extension === '.pptx' ? (await extractPptxBuffer(buffer, file.name)).text : new TextDecoder('utf-8', { fatal: true }).decode(buffer);
      }
    }
    const snapshot = skeletonProjectSnapshot(project);
    const draftText = `Project context (recorded in Projects):\n${JSON.stringify(snapshot)}\n\n${text.trim()}`;
    if (!text.trim() || draftText.length > 60000) throw new Error('Provide readable evidence within 60,000 characters. Content is never silently truncated.');
    // The 18-item Paper Skeleton checklist applies to full drafts only; the sections form is not judged on missing paper text.
    const fullDraft = mode !== 'blocks';
    const result = await reviewSubmission({ draftText, draftName: `${project.title} — Skeleton Lock`, skills: ['vios-skeleton-lock'], reportTitle: 'VIOS Skeleton Lock review', targetVenue: project.venue || undefined, deadline: project.submissionDeadline || undefined, maxDraftChars: 60000,
      paperSkeleton: fullDraft, paperSkeletonSource: text.trim(), figures,
      extraInstructions: fullDraft ? undefined : 'The input is the Skeleton Lock sections form, not a full paper draft. Judge the stated evidence in each section. Do not treat the absence of full paper text (abstract, figures, notation, related work or a bibliography) as a gap or a reason for the verdict.' });
    const review = await withDatabaseTransaction(async () => {
      const saved = await saveSkeletonReview(projectId, snapshot, draftText, result, user);
      await recordAuditLog({ actor: user, action: 'skeleton.review_created', targetType: 'project', targetId: projectId, summary: 'Project-bound Skeleton Lock AI check saved.', metadata: { reviewId: saved.id } });
      return saved;
    });
    return NextResponse.json({ review });
  } catch (error) { return errorResponse(error, 400); }
}
