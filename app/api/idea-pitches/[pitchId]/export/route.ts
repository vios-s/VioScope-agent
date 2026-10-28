import { z } from 'zod';
import { AuthError, requireSessionUser } from '../../../../../src/mastra/auth/session';
import { getIdeaCheck } from '../../../../../src/mastra/db/idea-checks';
import { errorResponse } from '../../../../../src/mastra/http/error-response';
import { exportApprovedPitch } from '../../../../../src/mastra/projects/idea-export';
import { pitchExportFormats } from '../../../../../src/mastra/projects/idea-check';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ pitchId: string }> }) {
  try {
    const actor = await requireSessionUser(request);
    const { pitchId } = await context.params;
    const url = new URL(request.url);
    const format = z.enum(pitchExportFormats).parse(url.searchParams.get('format'));
    const version = z.coerce.number().int().positive().parse(url.searchParams.get('version'));
    const payload = await getIdeaCheck(z.string().uuid().parse(pitchId), actor);
    if (!payload.canManage) throw new AuthError('Only the proposer, PI and administrator can export this pitch.', 403, 'forbidden');
    const file = await exportApprovedPitch(payload, version, format);
    return new Response(new Uint8Array(file.body), { headers: {
      'Content-Type': file.mime, 'Content-Disposition': `attachment; filename="${file.filename}"`,
      'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
    } });
  } catch (error) { return errorResponse(error, 400); }
}
