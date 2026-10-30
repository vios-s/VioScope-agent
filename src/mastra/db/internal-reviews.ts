import {projectPIs,projectPDRAs} from '../projects/review-team';
import { randomUUID, createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { AuthError, canSeeAll } from '../auth/session';
import { createPostgresClient, withDatabaseTransaction } from './postgres';
import { ensureProjectTables, getProjectForUser } from './projects';
import { getUserByUsername, type AuthUser } from './users';
import { listProjectTasks } from './project-tasks';
import { recordAuditLog } from './audit-log';
import { skeletonProjectSnapshot } from '../submission/skeleton-record';
import { supersededReviewTask, internalReviewCommand, validatePublishedReview, type ReviewRound, type ReviewRoundData } from '../submission/internal-review';
import type { ProjectTask } from '../projects/workflow';

const columns = `id::text, project_id::text AS "projectId", submission_id::text AS "submissionId", revision, created_at::text AS "createdAt", data`;
const db = () => createPostgresClient().pool;
const conflict = () => new AuthError('This review or project changed. Reload before saving.',409,'conflict');
const forbidden = () => new AuthError('You do not have permission for this review operation.',403,'forbidden');
type Project = Awaited<ReturnType<typeof getProjectForUser>>;

export async function reviewRounds(projectId:string):Promise<ReviewRound[]> {
  return (await db().query(`SELECT ${columns} FROM internal_review_rounds WHERE project_id=$1 ORDER BY created_at DESC,id DESC`,[projectId])).rows;
}
async function currentContext(projectId:string) {
  const submission=(await db().query(`SELECT id::text,plan,result FROM project_submissions WHERE project_id=$1 AND is_current`,[projectId])).rows[0];
  const profile=(await db().query('SELECT revision FROM project_research WHERE project_id=$1',[projectId])).rows[0];
  return {submission,profileRevision:profile?.revision||0};
}
function canReview(project:Project,user:AuthUser,round:ReviewRound) {
  return user.username!==project.ownerUsername && user.provisioningStatus==='active' &&
    (canSeeAll(user)||projectPDRAs(project).includes(user.username)||project.collaborators.includes(user.username)||round.data.invited.includes(user.username));
}
function isCurrent(round:ReviewRound,latest:ReviewRound|undefined,context:Awaited<ReturnType<typeof currentContext>>,project:Project) {
  return round.id===latest?.id && round.submissionId===context.submission?.id && (!context.submission.result.outcome||context.submission.result.outcome==='planned') &&
    round.data.profileRevision===context.profileRevision && isDeepStrictEqual(round.data.projectSnapshot,skeletonProjectSnapshot(project));
}
export function reviewFingerprint(round:ReviewRound,tasks:ProjectTask[]) {
  return createHash('sha256').update(JSON.stringify({manuscript:round.data.manuscript,
    reviews:Object.entries(round.data.reviews).filter(([,r])=>r.versions.length).map(([id,r])=>[id,r.versions.at(-1)]),dispositions:round.data.dispositions,
    tasks:tasks.filter(t=>t.sourceId===round.id||t.data.priority==='high').map(t=>[t.id,t.revision]),
  })).digest('hex');
}
export function revisionBlockers(round:ReviewRound,tasks:ProjectTask[]) {
  const blockers:string[]=[];
  if(!Object.values(round.data.reviews).some(r=>r.username===round.data.pdra&&r.versions.length))blockers.push('The required PDRA review has not been submitted.');
  for(const [id,review] of Object.entries(round.data.reviews)) {
    const version=review.versions.at(-1);if(!version)continue;
    for(const finding of version.content.changes) {
      const disposition=round.data.dispositions.find(d=>d.reviewId===id&&d.version===version.version&&d.findingId===finding.id);
      if(!disposition){blockers.push(`Classify revision: ${finding.text}`);continue;}
      if(disposition.kind==='required') {
        const task=tasks.find(t=>t.id===disposition.taskId);
        if(!task||task.data.status!=='done'||!task.data.evidenceIds.length||!task.data.verification?.accepted||task.data.verification.revision!==task.revision)
          blockers.push(`PDRA acceptance required: ${finding.text}`);
      }
    }
  }
  if(tasks.some(t=>t.data.priority==='high'&&!['done','cancelled'].includes(t.data.status)))blockers.push('Unfinished high-priority project tasks remain.');
  if(tasks.some(t=>t.sourceKind==='internal_review'&&t.data.priority==='high'&&t.data.status!=='cancelled'&&
    (t.data.status!=='done'||!t.data.evidenceIds.length||!t.data.verification?.accepted||t.data.verification.revision!==t.revision)))blockers.push('All required revisions, including earlier review versions, need PDRA acceptance or explicit retirement.');
  return blockers;
}
async function activeAccessible(projectId:string,username:string) {
  const user=await getUserByUsername(username);
  if(!user||user.provisioningStatus!=='active')throw new Error('Choose an active personal account.');
  await getProjectForUser(projectId,user);return user;
}
async function availableEvidence(projectId:string,ids:string[]) {
  return (await db().query(`SELECT e.id::text,e.data FROM project_evidence e
    LEFT JOIN project_artifacts a ON a.id::text=e.data->>'artifactId' AND a.project_id=e.project_id AND a.deleted_at IS NULL
    WHERE e.project_id=$1 AND e.id=ANY($2::uuid[]) AND e.data->>'state'='completed'
      AND CASE WHEN COALESCE(e.data->>'artifactId','')<>'' THEN a.id IS NOT NULL ELSE COALESCE(e.data->>'url','')<>'' END`,[projectId,ids])).rows;
}
async function completedEvidence(projectId:string,id:string) {
  const row=(await availableEvidence(projectId,[id]))[0];
  if(!row)throw new Error('Choose completed evidence with an available project artifact or source URL.');
  return row.data;
}
/** Used by approval writes, project/checklist displays and reminders, including legacy saved locks. */
export async function reviewEvidenceBlockers(projectId:string,round:ReviewRound,tasks:ProjectTask[],finalManuscript=round.data.lock?.finalManuscript) {
  const documents=[round.data.manuscript,...(finalManuscript?[finalManuscript]:[])];
  const ids=[...new Set([...documents.map(m=>m.evidenceId),...tasks.filter(t=>t.sourceKind==='internal_review'&&t.data.priority==='high'&&t.data.status!=='cancelled').flatMap(t=>t.data.evidenceIds)])];
  const rows=await availableEvidence(projectId,ids);
  const available=new Map(rows.map(row=>[row.id,row.data]));
  return ids.flatMap(id=>!available.has(id)?['Review evidence is unavailable or its project material was removed.']:
    documents.some(m=>m.evidenceId===id)&&available.get(id).kind!=='document'?['The manuscript evidence must be a document.']:[]);
}
async function decision(round:ReviewRound,project:Project,user:AuthUser,checkpoint:string,outcome:string,reason:string,evidenceIds:string[]) {
  await db().query(`INSERT INTO project_decisions(project_id,submission_id,data,decided_by) VALUES($1,$2,$3::jsonb,$4)`,[
    project.id,round.submissionId,JSON.stringify({checkpoint,outcome,reason,conditions:'',reviewDue:null,evidenceIds,profileRevision:round.data.profileRevision,
      projectSnapshot:skeletonProjectSnapshot(project),rulesVersion:'internal-review-v1',internalReviewRoundId:round.id,roundRevision:round.revision+1}),user.username]);
}

export async function getInternalReviews(projectId:string,user:AuthUser) {
  const project=await getProjectForUser(projectId,user);
  const context=await currentContext(projectId), rounds=await reviewRounds(projectId), tasks=await listProjectTasks(projectId);
  const evidence=(await db().query(`SELECT id::text,data FROM project_evidence WHERE project_id=$1 ORDER BY created_at DESC`,[projectId])).rows as {id:string;data:{title:string;state:string;url?:string;artifactId?:string}}[];
  const current=rounds[0];
  const visible=await Promise.all(rounds.map(async round=>{
    const valid=project.lifecycle==='active'&&isCurrent(round,current,context,project);
    const fingerprint=reviewFingerprint(round,tasks);
    const blockers=[...revisionBlockers(round,tasks),...await reviewEvidenceBlockers(projectId,round,tasks)];
    const lockValid=valid&&!blockers.length&&round.data.lock?.fingerprint===fingerprint;
    // Unsubmitted drafts never leave the server except to their own reviewer, including for PI/admin.
    const reviews=Object.fromEntries(Object.entries(round.data.reviews).flatMap(([id,review])=>{
      if(!review.versions.length&&review.username!==user.username)return [];
      const {draft,...published}=review;return [[id,{...published,...(review.username===user.username?{draft}: {})}]];
    }));
    return {...round,data:{...round.data,reviews},current:valid,lockValid,
      clearanceValid:lockValid&&round.data.clearance?.fingerprint===fingerprint&&round.data.clearance.outcome==='submit',
      blockers,canReview:valid&&canReview(project,user,round),
    };
  }));
  return {project:{id:project.id,title:project.title,ownerUsername:project.ownerUsername,pdraUsername:project.pdraUsername,piUsername:project.piUsername,piUsernames:projectPIs(project),pdraUsernames:projectPDRAs(project),collaborators:project.collaborators,artifacts:project.artifacts},
    submission:context.submission||null,rounds:visible,tasks:tasks.filter(t=>t.sourceKind==='internal_review'),evidence,
    viewer:{username:user.username,canStart:project.lifecycle==='active'&&user.provisioningStatus==='active'&&user.username===project.ownerUsername,canInvite:project.access.canEdit,lead:user.username!==project.ownerUsername&&user.username===project.pdraUsername&&user.provisioningStatus==='active',
      pi:user.username!==project.ownerUsername&&(user.role==='administrator'||(user.role==='pi'&&projectPIs(project).includes(user.username))),owner:user.username===project.ownerUsername},
  };
}

export async function changeInternalReview(projectId:string,input:unknown,user:AuthUser) {
  const command=internalReviewCommand.parse(input);
  await ensureProjectTables();
  return withDatabaseTransaction(async()=>{
    await db().query('SELECT id FROM project_records WHERE id=$1 FOR UPDATE',[projectId]);
    const project=await getProjectForUser(projectId,user);
    if(project.lifecycle!=='active'||user.provisioningStatus!=='active')throw forbidden();
    const context=await currentContext(projectId), rounds=await reviewRounds(projectId);
    const at=new Date().toISOString();
    let startedRoundId:string|undefined;
    if(command.operation==='start') {
      if(user.username!==project.ownerUsername)throw forbidden();
      if(!context.submission||context.submission.id!==command.submissionId||!['planned',undefined].includes(context.submission.result.outcome))throw new Error('Choose an active submission plan.');
      if((rounds[0]?.id||null)!==command.previousRoundId)throw conflict();
      if(!project.pdraUsername||project.pdraUsername===project.ownerUsername)throw new Error('Assign an independent PDRA before submitting a manuscript.');
      await activeAccessible(projectId,project.pdraUsername);
      const evidence=await completedEvidence(projectId,command.manuscript.evidenceId);
      if(evidence.kind!=='document')throw new Error('The manuscript must be completed document evidence.');
      const data:ReviewRoundData={manuscript:command.manuscript,pdra:project.pdraUsername,profileRevision:context.profileRevision,projectSnapshot:skeletonProjectSnapshot(project),
        redTeam:{status:'pending',startedAt:at,reports:[]},invited:[],reviews:{},dispositions:[],responses:[],history:[{by:user.username,at,action:'start',detail:command.manuscript}]};
      startedRoundId=(await db().query('INSERT INTO internal_review_rounds(project_id,submission_id,data) VALUES($1,$2,$3::jsonb) RETURNING id::text',[projectId,command.submissionId,JSON.stringify(data)])).rows[0].id;
    } else {
      const round=rounds.find(r=>r.id===command.roundId);
      if(!round||round.revision!==command.revision||!isCurrent(round,rounds[0],context,project))throw conflict();
      const owner=user.username===project.ownerUsername,lead=!owner&&user.username===project.pdraUsername;
      const tasks=await listProjectTasks(projectId);
      let detail:unknown=command.operation;
      if(command.operation==='review') {
        if(!canReview(project,user,round))throw forbidden();
        const entry=Object.entries(round.data.reviews).find(([,r])=>r.username===user.username);
        const id=entry?.[0]||randomUUID(), review=entry?.[1]||{username:user.username,versions:[]};
        if(command.publish){
          validatePublishedReview(command.content);
          review.versions.push({version:review.versions.length+1,at,content:command.content});delete review.draft;
          detail={reviewId:id,version:review.versions.length};
        }else {review.draft=command.content;detail={reviewId:id,draft:true};}
        round.data.reviews[id]=review;
      } else if(command.operation==='invite') {
        if(!project.access.canEdit&&!lead)throw forbidden();
        const invited=await activeAccessible(projectId,command.username);
        if(invited.username===project.ownerUsername)throw new Error('The owner cannot review their own project.');
        round.data.invited=[...new Set([...round.data.invited,invited.username])];detail={username:invited.username};
      } else if(command.operation==='respond') {
        if(!owner)throw forbidden();
        if(!round.data.reviews[command.reviewId]?.versions.length)throw new Error('Choose a submitted review.');
        round.data.responses.push({reviewId:command.reviewId,by:user.username,at,text:command.text});detail={reviewId:command.reviewId};
      } else if(command.operation==='triage') {
        if(!lead)throw forbidden();
        const review=round.data.reviews[command.reviewId]?.versions.find(v=>v.version===command.version);
        const finding=review?.content.changes.find(f=>f.id===command.findingId);
        if(!finding||review?.version!==command.version)throw conflict();
        const previous=round.data.dispositions.find(d=>d.reviewId===command.reviewId&&d.version===command.version&&d.findingId===command.findingId);
        let taskId=previous?.taskId||null;
        if(command.kind!=='declined') {
          const assignee=await activeAccessible(projectId,command.owner);
          const existing=tasks.find(t=>t.id===taskId);
          taskId ||= randomUUID();
          const taskData={task:finding.text,owner:assignee.username,dueDate:command.dueDate,priority:command.kind==='required'?'high':'normal',status:'open',note:command.reason,evidenceIds:[],
            history:[...(existing?.data.history||[]),{by:user.username,at,status:'open',note:command.reason}]};
          await db().query(`INSERT INTO project_tasks(id,project_id,source_kind,source_id,data) VALUES($1,$2,'internal_review',$3,$4::jsonb)
            ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data,revision=project_tasks.revision+1`,[taskId,projectId,round.id,JSON.stringify(taskData)]);
        } else if(taskId) {
          const existing=tasks.find(t=>t.id===taskId)!;
          await db().query('UPDATE project_tasks SET data=$2::jsonb,revision=revision+1 WHERE id=$1',[taskId,JSON.stringify({...existing.data,status:'cancelled',verification:undefined,history:[...existing.data.history,{by:user.username,at,status:'cancelled',note:command.reason}]})]);
        }
        const disposition={reviewId:command.reviewId,version:command.version,findingId:command.findingId,kind:command.kind,reason:command.reason,taskId,by:user.username,at};
        round.data.dispositions=round.data.dispositions.filter(d=>d!==previous).concat(disposition);detail=disposition;
      } else if(command.operation==='retire_task') {
        if(!lead)throw forbidden();
        const task=tasks.find(t=>t.id===command.taskId&&supersededReviewTask(round,t));
        if(!task||task.revision!==command.taskRevision)throw conflict();
        await db().query('UPDATE project_tasks SET data=$2::jsonb,revision=revision+1 WHERE id=$1',[task.id,JSON.stringify({...task.data,status:'cancelled',verification:undefined,
          history:[...task.data.history,{by:user.username,at,status:'cancelled',note:`Retired in round ${round.id}: ${command.reason}`}],
        })]);detail={taskId:task.id,reason:command.reason};
      } else if(command.operation==='verify') {
        if(!lead)throw forbidden();
        const task=tasks.find(t=>t.id===command.taskId&&t.sourceKind==='internal_review');
        if(!task||task.revision!==command.taskRevision)throw conflict();
        if(command.accepted){
          if(task.data.status!=='done'||!task.data.evidenceIds.length)throw new Error('Complete the task and link evidence before PDRA acceptance.');
          for(const id of task.data.evidenceIds)await completedEvidence(projectId,id);
        }
        await db().query('UPDATE project_tasks SET data=$2::jsonb,revision=revision+1 WHERE id=$1',[task.id,JSON.stringify({...task.data,
          status:command.accepted?'done':'in_progress',verification:{by:user.username,at,revision:task.revision+1,accepted:command.accepted,reason:command.reason},
          history:[...task.data.history,{by:user.username,at,status:command.accepted?'done':'in_progress',note:`PDRA ${command.accepted?'accepted':'returned'}: ${command.reason}`}],
        })]);detail={taskId:task.id,accepted:command.accepted,reason:command.reason};
      } else if(command.operation==='lock') {
        if(!lead)throw forbidden();
        await activeAccessible(projectId,round.data.pdra);
        const blockers=[...revisionBlockers(round,tasks),...await reviewEvidenceBlockers(projectId,round,tasks,command.finalManuscript)];if(blockers.length)throw new Error(blockers.join(' '));
        const evidence=await completedEvidence(projectId,command.finalManuscript.evidenceId);
        if(evidence.kind!=='document')throw new Error('Choose the final manuscript as completed document evidence.');
        round.data.lock={by:user.username,at,fingerprint:reviewFingerprint(round,tasks),reason:command.reason,finalManuscript:command.finalManuscript};
        delete round.data.clearance;
        await decision(round,project,user,'internal_review','proceed',command.reason,[round.data.manuscript.evidenceId]);
        await decision(round,project,user,'revision_lock','proceed',command.reason,[command.finalManuscript.evidenceId]);detail=round.data.lock;
      } else if(command.operation==='clearance') {
        if(owner||!(user.role==='administrator'||(user.role==='pi'&&projectPIs(project).includes(user.username))))throw forbidden();
        const fingerprint=reviewFingerprint(round,tasks);
        if(!round.data.lock||round.data.lock.fingerprint!==fingerprint||revisionBlockers(round,tasks).length||(await reviewEvidenceBlockers(projectId,round,tasks)).length)throw new Error('Pass the current Revision Lock before final PI clearance.');
        await activeAccessible(projectId,round.data.pdra);
        round.data.clearance={by:user.username,at,fingerprint,outcome:command.outcome,reason:command.reason};
        await decision(round,project,user,'submission_clearance',command.outcome==='submit'?'proceed':'defer',command.reason,[round.data.lock.finalManuscript.evidenceId]);detail=round.data.clearance;
      }
      round.data.history.push({by:user.username,at,action:command.operation,detail});
      await db().query('UPDATE internal_review_rounds SET data=$2::jsonb,revision=revision+1 WHERE id=$1',[round.id,JSON.stringify(round.data)]);
    }
    await recordAuditLog({actor:user,action:`internal_review.${command.operation}`,targetType:'project',targetId:projectId,summary:'Internal review workflow updated.'});
    return {ok:true,...(startedRoundId?{roundId:startedRoundId}:{})};
  });
}
