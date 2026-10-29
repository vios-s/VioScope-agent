import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireSessionUser } from '../../../../../src/mastra/auth/session';
import { errorResponse } from '../../../../../src/mastra/http/error-response';
import { getProjectWorkflow, changeProjectWorkflow } from '../../../../../src/mastra/db/project-workflow';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request,context:{params:Promise<{projectId:string}>}){
 try{const user=await requireSessionUser(request);const {projectId}=await context.params;return NextResponse.json(await getProjectWorkflow(z.string().uuid().parse(projectId),user));}catch(error){return errorResponse(error,400);}
}
export async function POST(request:Request,context:{params:Promise<{projectId:string}>}){
 try{const user=await requireSessionUser(request);const {projectId}=await context.params;return NextResponse.json(await changeProjectWorkflow(z.string().uuid().parse(projectId),await request.json(),user));}catch(error){return errorResponse(error,400);}
}
