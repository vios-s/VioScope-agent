import {after,NextResponse} from 'next/server';
import {z} from 'zod';
import {requireSessionUser} from '../../../../../../src/mastra/auth/session';
import {errorResponse} from '../../../../../../src/mastra/http/error-response';
import {uploadReviewManuscript,maxReviewPdfBytes} from '../../../../../../src/mastra/db/internal-review-upload';
import {runInternalRedTeam} from '../../../../../../src/mastra/db/internal-red-team';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=180;
export async function POST(request:Request,context:{params:Promise<{projectId:string}>}) {
  try {
    const user=await requireSessionUser(request),{projectId}=await context.params,id=z.string().uuid().parse(projectId);
    const contentType=request.headers.get('content-type')||'';
    if(!contentType.startsWith('multipart/form-data'))throw new Error('Upload a PDF using the manuscript form.');
    const reader=request.body?.getReader();if(!reader)throw new Error('No PDF was uploaded.');
    const chunks:Uint8Array[]=[];let size=0;
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>maxReviewPdfBytes+65536){await reader.cancel();throw new Error('The upload exceeds the 5 MB PDF limit.');}chunks.push(value);}
    const form=await new Response(Buffer.concat(chunks),{headers:{'Content-Type':contentType}}).formData();
    const file=form.get('pdf');if(!(file instanceof File))throw new Error('Choose a PDF manuscript.');
    const result=await uploadReviewManuscript(id,{submissionId:form.get('submissionId'),previousRoundId:form.get('previousRoundId')||null,label:form.get('label'),confirmed:form.get('confirmed')==='true'},file,user);
    if(result.roundId)after(async()=>{try{await runInternalRedTeam(id,result.roundId!,user);}catch{/* The saved round remains available for an explicit retry. */}});
    return NextResponse.json(result);
  }catch(error){return errorResponse(error,400);}
}
