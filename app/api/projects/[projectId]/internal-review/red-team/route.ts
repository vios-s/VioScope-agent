import {NextResponse} from 'next/server';
import {z} from 'zod';
import {requireSessionUser} from '../../../../../../src/mastra/auth/session';
import {errorResponse} from '../../../../../../src/mastra/http/error-response';
import {runInternalRedTeam} from '../../../../../../src/mastra/db/internal-red-team';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(request:Request,context:{params:Promise<{projectId:string}>}) {
  try {
    const user=await requireSessionUser(request),{projectId}=await context.params;
    const raw=await request.text();if(raw.length>1000)throw new Error('The request is too large.');
    const {roundId}=z.object({roundId:z.string().uuid()}).strict().parse(JSON.parse(raw));
    await runInternalRedTeam(z.string().uuid().parse(projectId),roundId,user);
    return NextResponse.json({ok:true});
  }catch(error){return errorResponse(error,400);}
}
