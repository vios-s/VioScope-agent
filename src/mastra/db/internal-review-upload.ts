import {rm} from 'node:fs/promises';
import {z} from 'zod';
import {AuthError} from '../auth/session';
import {getUserByUsername,type AuthUser} from './users';
import {getProjectForUser,addProjectUpdate} from './projects';
import {createPostgresClient,withDatabaseTransaction} from './postgres';
import {saveProjectArtifactUpload} from '../projects/artifacts';
import {extractDocumentText} from '../projects/idea-import';
import {changeInternalReview} from './internal-reviews';
import {recordAuditLog} from './audit-log';
const metadata=z.object({submissionId:z.string().uuid(),previousRoundId:z.string().uuid().nullable(),label:z.string().trim().min(1).max(200),confirmed:z.literal(true)}).strict();
export const maxReviewPdfBytes=5*1024*1024;
async function ownerProject(projectId:string,user:AuthUser) {
  const actor=await getUserByUsername(user.username);
  if(!actor||actor.id!==user.id||actor.sessionVersion!==user.sessionVersion||actor.provisioningStatus!=='active')throw new AuthError('Your session changed. Sign in again.',401,'unauthorized');
  const project=await getProjectForUser(projectId,actor);
  if(project.lifecycle!=='active'||project.ownerUsername!==actor.username)throw new AuthError('Only the active project owner may upload a manuscript.',403,'forbidden');
  return {project,actor};
}
export async function uploadReviewManuscript(projectId:string,input:unknown,file:File,user:AuthUser) {
  const command=metadata.parse(input);const {project}=await ownerProject(projectId,user);
  if(!file.name.toLowerCase().endsWith('.pdf')||file.size<=0||file.size>maxReviewPdfBytes)throw new Error('Choose a non-empty PDF of at most 5 MB.');
  const bytes=new Uint8Array(await file.slice(0,5).arrayBuffer());
  if(new TextDecoder().decode(bytes)!=='%PDF-')throw new Error('The selected file is not a PDF.');
  const text=await extractDocumentText(file);
  if(text.length>200000)throw new Error('The PDF exceeds 200,000 extracted characters. Upload a shorter manuscript; content is not silently truncated.');
  // Reuse the immutable project-file store; the validated text avoids a second model call for an artifact digest.
  const summary=`Manuscript PDF for Internal Review: ${command.label}. Extracted text: ${text.length} characters.`;
  const uploaded=await saveProjectArtifactUpload(project,file,{text,summary});
  try {
    return await withDatabaseTransaction(async()=>{
      const db=createPostgresClient().pool;
      await db.query('SELECT id FROM project_records WHERE id=$1 FOR UPDATE',[projectId]);
      const {actor}=await ownerProject(projectId,user);
      const updated=await addProjectUpdate(projectId,{type:'artifact',text:`Uploaded manuscript ${command.label} for Internal Review.`,artifact:uploaded.artifact},actor);
      const artifact=updated.artifacts.find(a=>a.path===uploaded.artifact.path);if(!artifact)throw new Error('The uploaded project material could not be registered.');
      const evidence=(await db.query(`INSERT INTO project_evidence(project_id,data,created_by) VALUES($1,$2::jsonb,$3) RETURNING id::text`,[projectId,JSON.stringify({title:command.label,claim:'Manuscript submitted for Internal Review',kind:'document',state:'completed',summary,artifactId:artifact.id,url:null}),actor.username])).rows[0].id;
      const result=await changeInternalReview(projectId,{operation:'start',confirmed:true,submissionId:command.submissionId,previousRoundId:command.previousRoundId,manuscript:{label:command.label,evidenceId:evidence}},actor);
      await recordAuditLog({actor,action:'internal_review.manuscript_uploaded',targetType:'project',targetId:projectId,summary:'Owner uploaded a PDF, linked project material and evidence, and started a review round.',metadata:{artifactId:artifact.id,evidenceId:evidence,roundId:result.roundId}});
      return {...result,artifactId:artifact.id,evidenceId:evidence};
    });
  }catch(error){await rm(uploaded.artifact.path!,{force:true});throw error;}
}
