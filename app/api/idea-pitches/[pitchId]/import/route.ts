import 'dotenv/config';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireSessionUser } from '../../../../../src/mastra/auth/session';
import { errorResponse } from '../../../../../src/mastra/http/error-response';
import { getIdeaCheck } from '../../../../../src/mastra/db/idea-checks';
import { checkedSource, extractPitchUpload, organizePitchSource } from '../../../../../src/mastra/projects/idea-import';
import { recordAuditLog } from '../../../../../src/mastra/db/audit-log';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request, context: { params: Promise<{ pitchId: string }> }) {
  try {
    const actor = await requireSessionUser(request);
    const { pitchId } = await context.params;
    z.string().uuid().parse(pitchId);
    const state = await getIdeaCheck(pitchId, actor);
    if (!state.canEdit) throw new Error('Only an editable pitch owned by you or managed by a PI or administrator can be imported.');
    const form = await request.formData();
    const file = form.get('file'); const text = form.get('text');
    const hasFile = file instanceof File && file.size > 0;
    const hasText = typeof text === 'string' && Boolean(text.trim());
    if (hasFile === hasText) throw new Error('Choose one input: upload a document or paste its text.');
    const source = hasFile ? await extractPitchUpload(file as File) : { name: 'Pasted pitch', text: checkedSource(text as string), method: 'paste' as const };
    const draft = await organizePitchSource(source.text);
    await recordAuditLog({ actor, action: 'idea_pitch.import_preview', targetType: 'idea_pitch', targetId: pitchId,
      summary: 'User prepared a pitch import preview.', metadata: { source: source.method, chars: source.text.length } });
    return NextResponse.json({ source, draft });
  } catch (error) { return errorResponse(error, 400); }
}
