import { after, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireSessionUser } from '../../../../../src/mastra/auth/session';
import { errorResponse } from '../../../../../src/mastra/http/error-response';
import { changeInternalReview, getInternalReviews } from '../../../../../src/mastra/db/internal-reviews';
import {runInternalRedTeam} from '../../../../../src/mastra/db/internal-red-team';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request,context:{params:Promise<{projectId:string}>}) {
  try {const user=await requireSessionUser(request);const {projectId}=await context.params;return NextResponse.json(await getInternalReviews(z.string().uuid().parse(projectId),user));}
  catch(error){return errorResponse(error,400);}
}
export async function POST(request:Request,context:{params:Promise<{projectId:string}>}) {
  try {const user=await requireSessionUser(request);const {projectId}=await context.params;
    const raw=await request.text();if(raw.length>150000)throw new Error('The review request is too large.');
    const id=z.string().uuid().parse(projectId);
    const result=await changeInternalReview(id,JSON.parse(raw),user);
    if(result.roundId)after(async()=>{try{await runInternalRedTeam(id,result.roundId!,user);}catch{/* A changed project can prevent the automatic run; the saved round remains available. */}});
    return NextResponse.json(result);}
  catch(error){return errorResponse(error,400);}
}
