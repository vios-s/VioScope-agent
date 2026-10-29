import { AuthError, canSeeAll } from '../auth/session';
import type { AuthUser } from './users';
import { getUserByUsername } from './users';
import { createPostgresClient, withDatabaseTransaction } from './postgres';
import { ensureProjectTables, getProjectForUser } from './projects';
import { getSkeletonReview, projectSkeletonReviewChoices } from './skeleton-reviews';
import { latestSkeletonDecisions, skeletonProjectSnapshot } from '../submission/skeleton-record';
import { isDeepStrictEqual } from 'node:util';
import { researchSchema, workflowCommandSchema, submissionTimeline, type ResearchProfile, type ProjectTask, type WorkflowCommand } from '../projects/workflow';
import { listProjectTasks, taskColumns } from './project-tasks';
import { readMeetingWorkflow } from '../theme-meetings/workflow';
import { recordAuditLog } from './audit-log';

export async function seedProjectResearch(projectId:string, profile:Partial<ResearchProfile>, by:string) {
 await createPostgresClient().pool.query(`INSERT INTO project_research(project_id,profile,history) VALUES($1,$2::jsonb,$3::jsonb) ON CONFLICT(project_id) DO NOTHING`,[projectId,JSON.stringify(researchSchema.parse(profile)),JSON.stringify([{by,at:new Date().toISOString(),reason:'Inherited from the approved idea pitch.',profile:researchSchema.parse(profile)}])]);
}
export async function getProjectWorkflow(projectId:string,user:AuthUser) {
 const project=await getProjectForUser(projectId,user);
 await readMeetingWorkflow();
 const db=createPostgresClient();
 if(!(await db.pool.query('SELECT 1 FROM project_research WHERE project_id=$1',[project.id])).rowCount && (await db.pool.query("SELECT to_regclass('project_idea_origins') AS existing")).rows[0].existing){
  const origin=(await db.pool.query('SELECT snapshot FROM project_idea_origins WHERE project_id=$1',[project.id])).rows[0]?.snapshot;
  if(origin)await seedProjectResearch(project.id,{question:origin.draft.question,claim:origin.draft.coreIdea || origin.draft.contribution,validation:origin.draft.validation,resourceNotes:origin.draft.resources,risks:origin.draft.risks},origin.approvedBy);
 }
 const research=(await db.pool.query('SELECT revision,profile,history FROM project_research WHERE project_id=$1',[project.id])).rows[0]||{revision:0,profile:researchSchema.parse({}),history:[]};
 const submissions=(await db.pool.query(`SELECT id::text,revision,is_current AS "isCurrent",plan,result,history,created_at AS "createdAt" FROM project_submissions WHERE project_id=$1 ORDER BY created_at DESC,id DESC`,[project.id])).rows;
 const evidence=(await db.pool.query(`SELECT id::text,data,created_by AS "createdBy",created_at AS "createdAt" FROM project_evidence WHERE project_id=$1 ORDER BY created_at DESC`,[project.id])).rows;
 const decisions=(await db.pool.query(`SELECT id::text,submission_id::text AS "submissionId",data,decided_by AS "decidedBy",created_at AS "createdAt" FROM project_decisions WHERE project_id=$1 ORDER BY created_at DESC`,[project.id])).rows;
 return {project,skeletonReviews:await projectSkeletonReviewChoices(project.id,user),research:{...research,profile:researchSchema.parse(research.profile)},submissions:submissions.map(item=>({...item,timeline:submissionTimeline(item.plan)})),evidence,decisions:decisions.map(item=>({...item,contextChanged:!isDeepStrictEqual(item.data.projectSnapshot,skeletonProjectSnapshot(project))})),tasks:await listProjectTasks(project.id),viewer:{username:user.username,manager:canSeeAll(user),reviewer:user.username===project.pdraUsername||canSeeAll(user)}};
}
function conflict() { return new AuthError('This record changed. Reload before saving.',409,'conflict'); }
async function checkEvidence(projectId:string,ids:string[],completed=false) {
 if(!ids.length){if(completed)throw new Error('Link completed evidence before approving this checkpoint.');return;}
 const rows=(await createPostgresClient().pool.query('SELECT id::text,data FROM project_evidence WHERE project_id=$1 AND id=ANY($2::uuid[])',[projectId,ids])).rows;
 if(rows.length!==new Set(ids).size||completed&&rows.some(row=>row.data.state!=='completed'))throw new Error('Choose evidence from this project; approvals require completed evidence.');
}
async function checkAssignee(projectId:string,username:string) {
 const account=await getUserByUsername(username);
 if(!account||account.provisioningStatus!=='active')throw new Error('Choose an active account username.');
 await getProjectForUser(projectId,account);
}
export async function changeProjectWorkflow(projectId:string,input:unknown,user:AuthUser) {
 const command=workflowCommandSchema.parse(input);
 await ensureProjectTables();
 // Import old meeting tasks before locking this project; the file lock is always acquired first.
 await readMeetingWorkflow();
 return withDatabaseTransaction(async()=>{
  const db=createPostgresClient();
  await db.pool.query('SELECT id FROM project_records WHERE id=$1 FOR UPDATE',[projectId]);
  const project=await getProjectForUser(projectId,user);
  if(project.lifecycle==='archived')throw new Error('Restore the archived project before changing its workflow.');
  const edit=project.access.canEdit, reviewer=canSeeAll(user)||project.pdraUsername===user.username;
  if(command.operation==='decision'?!reviewer:command.operation==='task_update'?false:!edit)throw new AuthError('You do not have permission for this project operation.',403,'forbidden');
  const at=new Date().toISOString();
  if(command.operation==='research'){
   for(const resource of command.profile.resources){if(resource.owner)await checkAssignee(projectId,resource.owner);if(resource.kind==='approval'&&resource.status==='available'&&!resource.evidence)throw new Error('An available approval needs its approval reference.');}
   await db.pool.query('INSERT INTO project_research(project_id) VALUES($1) ON CONFLICT DO NOTHING',[projectId]);
   const current=(await db.pool.query('SELECT revision,profile FROM project_research WHERE project_id=$1 FOR UPDATE',[projectId])).rows[0];
   if(current.revision!==command.revision)throw conflict();
   await db.pool.query(`UPDATE project_research SET profile=$2::jsonb,revision=revision+1,history=history||$3::jsonb WHERE project_id=$1`,[projectId,JSON.stringify(command.profile),JSON.stringify([{by:user.username,at,reason:command.reason,previous:current.profile,profile:command.profile}])]);
  }else if(command.operation==='submission'){
   const current=(await db.pool.query('SELECT id::text FROM project_submissions WHERE project_id=$1 AND is_current',[projectId])).rows[0];
   if((current?.id||null)!==command.currentId)throw conflict();
   await db.pool.query('UPDATE project_submissions SET is_current=false WHERE project_id=$1 AND is_current',[projectId]);
   await db.pool.query(`INSERT INTO project_submissions(project_id,plan,history) VALUES($1,$2::jsonb,$3::jsonb)`,[projectId,JSON.stringify(command.plan),JSON.stringify([{by:user.username,at,reason:command.reason,plan:command.plan}])]);
   const parts=new Intl.DateTimeFormat('en-CA',{timeZone:command.plan.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(command.plan.deadline));
   await db.pool.query('UPDATE project_records SET venue=$2,submission_deadline=$3::date,updated_at=now() WHERE id=$1',[projectId,command.plan.venue,parts]);
  }else if(command.operation==='submission_result'){
   const row=(await db.pool.query('SELECT revision,plan,result FROM project_submissions WHERE id=$1 AND project_id=$2 FOR UPDATE',[command.id,projectId])).rows[0];
   if(!row)throw new Error('Submission not found.');if(row.revision!==command.revision)throw conflict();
   if(['submitted','accepted','rejected'].includes(command.outcome)&&!command.submittedAt)throw new Error('Record the actual submission time.');
   if(['accepted','rejected','withdrawn','deferred'].includes(command.outcome)&&(!command.lessons||!command.nextPlan))throw new Error('Record lessons and the next plan for this outcome.');
   const {operation:_,confirmed:__,revision:___,id:____,reason,...result}=command;
   await db.pool.query(`UPDATE project_submissions SET result=$2::jsonb,revision=revision+1,history=history||$3::jsonb WHERE id=$1`,[command.id,JSON.stringify(result),JSON.stringify([{by:user.username,at,reason,previous:row.result,result}])]);
  }else if(command.operation==='evidence'){
   if(command.artifactId && !project.artifacts.some(item=>item.id===command.artifactId))throw new Error('Choose a visible artifact version from this project.');
   if(command.state==='completed'&&!command.artifactId&&!command.url)throw new Error('Completed evidence needs an artifact version or source URL.');
   const {operation:_,confirmed:__,...data}=command;
   await db.pool.query('INSERT INTO project_evidence(project_id,data,created_by) VALUES($1,$2::jsonb,$3)',[projectId,JSON.stringify(data),user.username]);
  }else if(command.operation==='task'){
   await checkAssignee(projectId,command.owner);
   if(command.sourceKind==='review'){
    if(!command.sourceId)throw new Error('Choose a saved Skeleton review as the source.');
    if((await getSkeletonReview(command.sourceId,user)).projectId!==projectId)throw new Error('The source review belongs to a different project.');
   }else if(command.sourceId)throw new Error('A project task cannot claim a review source.');
   await db.pool.query(`INSERT INTO project_tasks(project_id,source_kind,source_id,data) VALUES($1,$2,$3,$4::jsonb)`,[projectId,command.sourceKind,command.sourceId,JSON.stringify({task:command.task,owner:command.owner,dueDate:command.dueDate,priority:command.priority,status:'open',note:'',evidenceIds:[],history:[{by:user.username,at,status:'open',note:'Created'}]})]);
  }else if(command.operation==='task_update'){
   const row=(await db.pool.query(`SELECT ${taskColumns} FROM project_tasks WHERE id=$1 AND project_id=$2 FOR UPDATE`,[command.id,projectId])).rows[0] as ProjectTask|undefined;
   if(!row)throw new Error('Task not found.');if(row.revision!==command.revision)throw conflict();
   if(!edit&&row.data.owner!==user.username)throw new AuthError('Only the task assignee, project owner, PI or administrator can update this task.',403,'forbidden');
   if(row.sourceKind==='meeting'&&!['open','done'].includes(command.status))throw new Error('Meeting tasks use Open or Done.');
   const metadata={task:command.task??row.data.task,owner:command.owner??row.data.owner,dueDate:command.dueDate===undefined?row.data.dueDate:command.dueDate,priority:command.priority??row.data.priority};
   const metadataChanged=Object.entries(metadata).some(([key,value])=>value!==row.data[key as keyof typeof row.data]);
   if(metadataChanged&&(!edit||row.sourceKind==='meeting'))throw new Error('Only project managers can edit project task details; meeting assignments are managed in the meeting.');
   if(metadata.owner!==row.data.owner)await checkAssignee(projectId,metadata.owner);
   await checkEvidence(projectId,command.evidenceIds);
   await db.pool.query('UPDATE project_tasks SET data=$2::jsonb,revision=revision+1 WHERE id=$1',[row.id,JSON.stringify({...row.data,...metadata,status:command.status,note:command.note,evidenceIds:command.evidenceIds,history:[...row.data.history,{by:user.username,at,status:command.status,note:command.note,evidenceIds:command.evidenceIds,metadata}]})]);
  }else if(command.operation==='decision'){
   await recordDecision(projectId,command,user,project,at);
  }
  await recordAuditLog({actor:user,action:`project_workflow.${command.operation}`,targetType:'project',targetId:projectId,summary:'User confirmed a project workflow change.'});
  return {ok:true};
 });
}
async function recordDecision(projectId:string,command:Extract<WorkflowCommand,{operation:'decision'}>,user:AuthUser,project:Awaited<ReturnType<typeof getProjectForUser>>,at:string){
 const db=createPostgresClient();
 const profile=(await db.pool.query('SELECT revision,profile FROM project_research WHERE project_id=$1',[projectId])).rows[0]||{revision:0,profile:researchSchema.parse({})};
 if(command.profileRevision!==profile.revision)throw conflict();
 if(command.outcome==='conditional'&&(!command.conditions||!command.reviewDue))throw new Error('Conditional decisions need required actions and a review date.');
 const approval=command.outcome==='proceed';await checkEvidence(projectId,command.evidenceIds,approval);
 if(command.checkpoint!=='idea_lock'&&!command.submissionId)throw new Error('Choose the submission attempt for this checkpoint.');
 if(command.submissionId){
  const row=(await db.pool.query('SELECT is_current FROM project_submissions WHERE id=$1 AND project_id=$2',[command.submissionId,projectId])).rows[0];
  if(!row||!row.is_current)throw new Error('Choose the current submission attempt.');
 }
 let skeleton=null;
 if(command.skeletonReviewId){
  skeleton=await getSkeletonReview(command.skeletonReviewId,user);
  if(skeleton.projectId!==projectId)throw new Error('Choose a review from this project.');
 }
 if(command.checkpoint==='skeleton_lock'&&approval){
  if(!skeleton)throw new Error('Link the human-reviewed Skeleton check.');
  const latest=(await db.pool.query('SELECT id::text FROM skeleton_reviews WHERE project_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1',[projectId])).rows[0];
  if(latest.id!==skeleton.id||!isDeepStrictEqual(skeletonProjectSnapshot(project),skeleton.projectSnapshot)||latestSkeletonDecisions(skeleton.decisions).pi?.outcome!=='approved')throw new Error('The latest unchanged Skeleton check needs separate PDRA and PI checkpoint confirmation.');
 }
 if(command.checkpoint==='submission_clearance'){
  if(!canSeeAll(user))throw new AuthError('Only PI/admin can grant final submission clearance.',403,'forbidden');
  if(approval){
   const review=(await db.pool.query(`SELECT data FROM project_decisions WHERE project_id=$1 AND submission_id=$2 AND data->>'checkpoint'='internal_review' ORDER BY created_at DESC,id DESC LIMIT 1`,[projectId,command.submissionId])).rows[0];
   if(!review||review.data.outcome!=='proceed'||review.data.profileRevision!==profile.revision||!isDeepStrictEqual(review.data.projectSnapshot,skeletonProjectSnapshot(project)))throw new Error('Internal review must be cleared for this submission attempt.');
   const tasks=await listProjectTasks(projectId);
   if(tasks.some(task=>task.data.priority==='high'&&!['done','cancelled'].includes(task.data.status)))throw new Error('Complete high-priority tasks before final submission clearance.');
  }
 }
 const {operation:_,confirmed:__,...data}=command;
 await db.pool.query('INSERT INTO project_decisions(project_id,submission_id,data,decided_by) VALUES($1,$2,$3::jsonb,$4)',[projectId,command.submissionId,JSON.stringify({...data,profileSnapshot:profile.profile,projectSnapshot:skeletonProjectSnapshot(project),skeletonRevision:skeleton?.revision||null,at}),user.username]);
}
