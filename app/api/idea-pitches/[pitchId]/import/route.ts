import 'dotenv/config';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { AuthError, requireSessionUser } from '../../../../../src/mastra/auth/session';
import { errorResponse } from '../../../../../src/mastra/http/error-response';
import { getIdeaCheck } from '../../../../../src/mastra/db/idea-checks';
import { checkedSource, extractPitchUpload, organizePitchSource, suggestedPitchTitle } from '../../../../../src/mastra/projects/idea-import';
import { recordAuditLog } from '../../../../../src/mastra/db/audit-log';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request, context: { params: Promise<{ pitchId: string }> }) {
  try {
    const actor = await requireSessionUser(request);
    const { pitchId } = await context.params;
    // "new" previews an import before any record exists; any signed-in user may start a pitch. Saving creates the record.
    const isNew = pitchId === 'new';
    if (!isNew) z.string().uuid().parse(pitchId);
    const state = isNew ? { canEdit: true, canManage: true } : await getIdeaCheck(pitchId, actor);
    if (!state.canEdit) throw new AuthError(state.canManage ? 'This pitch has become a project and can no longer be edited.' : 'Only the proposer, PI or administrator can import into this pitch.', 403, 'forbidden');
    const form = await request.formData();
    const file = form.get('file'); const text = form.get('text');
    const hasFile = file instanceof File && file.size > 0;
    const hasText = typeof text === 'string' && Boolean(text.trim());
    if (hasFile === hasText) throw new Error('Choose one input: upload a document or paste its text.');
    const source = hasFile ? await extractPitchUpload(file as File) : { name: 'Pasted pitch', text: checkedSource(text as string), method: 'paste' as const };
    const draft = await organizePitchSource(source.text);
    await recordAuditLog({ actor, action: 'idea_pitch.import_preview', targetType: 'idea_pitch', targetId: isNew ? null : pitchId,
      summary: 'User prepared a pitch import preview.', metadata: { source: source.method, chars: source.text.length } });
    return NextResponse.json({ source, draft, title: suggestedPitchTitle(source.text) });
  } catch (error) { return errorResponse(error, 400); }
}
