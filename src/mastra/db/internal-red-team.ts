import {createHash,randomUUID} from 'node:crypto';
import {readFile,stat,realpath} from 'node:fs/promises';
import {extname} from 'node:path';
import {AuthError} from '../auth/session';
import {getUserByUsername,type AuthUser} from './users';
import {getProjectForUser} from './projects';
import {createPostgresClient,withDatabaseTransaction} from './postgres';
import {getInternalReviews,reviewRounds} from './internal-reviews';
import {assertStoredProjectArtifactPath} from '../projects/artifacts';
import {extractDocumentText} from '../projects/idea-import';
import {generateRedTeam,validateRedTeam,type RedTeamInput,type RedTeamState} from '../submission/internal-red-team';
import {recordAuditLog} from './audit-log';
import {manuscriptReadingText} from '../submission/manuscript-text';
const db=()=>createPostgresClient().pool;
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const conflict=()=>new AuthError('The project or manuscript changed during AI review. Reload and try again.',409,'conflict');
async function context(projectId:string,roundId:string,user:AuthUser) {
  const project=await getProjectForUser(projectId,user);
  const payload=await getInternalReviews(projectId,user),round=payload.rounds.find(r=>r.id===roundId);
  if(user.provisioningStatus!=='active'||!(payload.viewer.owner||payload.viewer.lead||payload.viewer.pi))throw new AuthError('Only the owner, lead PDRA or responsible PI may run the AI review.',403,'forbidden');
  if(!round?.current)throw conflict();
  const research=(await db().query('SELECT profile FROM project_research WHERE project_id=$1',[projectId])).rows[0]?.profile||{};
  const evidence=(await db().query('SELECT id::text,data FROM project_evidence WHERE project_id=$1 ORDER BY created_at,id',[projectId])).rows;
  const manuscript=evidence.find(e=>e.id===round.data.manuscript.evidenceId);
  if(!manuscript)throw conflict();
  const artifact=project.artifacts.find(a=>a.id===manuscript.data.artifactId);
  const sources:Record<string,string>={};
  const add=(key:string,value:unknown)=>{if(typeof value==='string'&&value.trim())sources[key]=value.trim();};
  add('project:title',project.title);add('project:notes',project.notes);add('project:target',project.target);add('project:blocker',project.blocker);
  for(const [key,value] of Object.entries(research))if(['question','claim','validation','risks','fallback','resourceNotes'].includes(key))add('research:'+key,value);
  for(const e of evidence.filter(e=>e.data.state==='completed'))add('evidence:'+e.id,`${e.data.title}\nClaim: ${e.data.claim}\nSummary: ${e.data.summary}`);
  for(const a of project.artifacts.filter(a=>a.isCurrent||a.id===artifact?.id))add('artifact-summary:'+a.id,a.summary);
  for(const u of project.updates.slice(0,10))add('progress:'+u.id,u.text);
  const limitations=['Project plans, summaries and progress are recorded claims, not independently verified results. Only the selected manuscript attachment is read; other materials contribute their recorded summaries. External document links are not fetched. Images, equations and table layout may not survive text extraction.'];
  if(project.updates.length>10)limitations.push('Only the ten most recent project updates are included.');
  const input:RedTeamInput={lead:project.ownerUsername,venue:payload.submission.plan.venue,manuscript:round.data.manuscript.label,sources,limitations};
  // Uploaded artifact versions are immutable; the context fingerprint also covers all cited summaries and progress.
  return {project,round,artifact,input,inputHash:hash({input,artifact:artifact?{id:artifact.id,path:artifact.path}:null,snapshot:round.data.projectSnapshot,profileRevision:round.data.profileRevision,submissionId:round.submissionId})};
}
async function addManuscript(input:RedTeamInput,ctx:Awaited<ReturnType<typeof context>>) {
  if(!ctx.artifact){input.limitations.push('No uploaded manuscript is linked. Abstract, Introduction and Results are assessable only where explicitly recorded in the project evidence; this is a partial review.');return;}
  try {
    const stored=await assertStoredProjectArtifactPath(ctx.artifact.path,ctx.project);
    const path=await assertStoredProjectArtifactPath(await realpath(stored),ctx.project),extension=extname(path).toLowerCase();
    const meta=await stat(path);if(!meta.isFile()||meta.size>5*1024*1024)throw new Error('The manuscript must be a file of at most 5 MB.');
    const bytes=await readFile(path);let text:string;
    if(['.pdf','.docx'].includes(extension))text=await extractDocumentText(new File([new Uint8Array(bytes)],'manuscript'+extension));
    else if(['.txt','.md','.markdown','.tex','.latex','.rst'].includes(extension))text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
    else throw new Error('Use a text-based PDF, DOCX, TXT, Markdown or LaTeX manuscript.');
    if(!text.trim())throw new Error('The manuscript has no readable text.');
    const reading=extension==='.pdf'?manuscriptReadingText(text):{text,removed:0};
    input.sources['manuscript:'+ctx.artifact.id]=reading.text;
    if(reading.removed)input.limitations.push(`${reading.removed} detected sequential PDF margin line numbers were removed from the reading text. All manuscript prose is retained; the original uploaded PDF is unchanged. Quotations refer to this saved reading text.`);
  }catch {input.limitations.push('The selected manuscript attachment could not be read. Upload a text-based PDF, DOCX, TXT, Markdown or LaTeX file of at most 5 MB and link it in a new round. This report covers recorded project evidence only.');}
}
/** AI state is separate from human round revisions and never changes approvals or tasks. */
export async function runInternalRedTeam(projectId:string,roundId:string,user:AuthUser,generate=generateRedTeam) {
  const token=randomUUID();
  const ctx=await withDatabaseTransaction(async()=>{
    await db().query('SELECT id FROM project_records WHERE id=$1 FOR UPDATE',[projectId]);
    const actor=await getUserByUsername(user.username);
    if(!actor||actor.sessionVersion!==user.sessionVersion)throw conflict();
    const current=await context(projectId,roundId,actor),ai=current.round.data.redTeam;
    if(ai?.status==='running'&&Date.now()-Date.parse(ai.startedAt)<180000)throw new AuthError('An AI review is already running. Please wait.',409,'conflict');
    await db().query("UPDATE internal_review_rounds SET data=jsonb_set(data,'{redTeam}',$2::jsonb) WHERE id=$1",[roundId,JSON.stringify({status:'running',startedAt:new Date().toISOString(),token,reports:ai?.reports||[]} satisfies RedTeamState)]);
    return current;
  });
  try {
    await addManuscript(ctx.input,ctx);
    if(JSON.stringify(ctx.input).length>240000)throw new Error('The combined project and manuscript input exceeds 240,000 characters. Use a shorter version; inputs are never silently truncated.');
    const result=await generate(ctx.input),output=validateRedTeam(result.output,ctx.input);
    await withDatabaseTransaction(async()=>{
      await db().query('SELECT id FROM project_records WHERE id=$1 FOR UPDATE',[projectId]);
      const actor=await getUserByUsername(user.username);if(!actor||actor.sessionVersion!==user.sessionVersion)throw conflict();
      const current=await context(projectId,roundId,actor),ai=current.round.data.redTeam;
      if(current.inputHash!==ctx.inputHash||ai?.token!==token)throw conflict();
      const report={id:randomUUID(),at:new Date().toISOString(),by:user.username,inputHash:ctx.inputHash,input:ctx.input,rules:result.rules,model:result.model,output};
      await db().query("UPDATE internal_review_rounds SET data=jsonb_set(data,'{redTeam}',$2::jsonb) WHERE id=$1",[roundId,JSON.stringify({status:'completed',startedAt:ai.startedAt,reports:[...ai.reports,report]} satisfies RedTeamState)]);
      await recordAuditLog({actor,action:'internal_review.red_team',targetType:'project',targetId:projectId,summary:'Advisory AI Red-Team report saved for a manuscript round.',metadata:{roundId,reportId:report.id}});
    });
  }catch(error){
    // Do not expose upstream URLs, credentials or provider error bodies to project readers.
    const message=error instanceof AuthError?'Project context or access changed. Reload before retrying.':'AI review could not be completed. Check the readable manuscript, project input size and configured AI service, then retry. The manuscript round and human reviews are saved.';
    await withDatabaseTransaction(async()=>{
      await db().query('SELECT id FROM project_records WHERE id=$1 FOR UPDATE',[projectId]);
      const round=(await reviewRounds(projectId)).find(r=>r.id===roundId),ai=round?.data.redTeam;
      if(ai?.token===token)await db().query("UPDATE internal_review_rounds SET data=jsonb_set(data,'{redTeam}',$2::jsonb) WHERE id=$1",[roundId,JSON.stringify({status:'failed',startedAt:ai.startedAt,error:message,reports:ai.reports} satisfies RedTeamState)]);
    });
  }
}
