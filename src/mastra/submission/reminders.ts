import { checklistCheckpoints } from '../db/checklist-checkpoints';
import {projectPIs} from '../projects/review-team';
import { createPostgresClient, withDatabaseTransaction } from '../db/postgres';
import { ensureProjectTables, getProjectForUser } from '../db/projects';
import { getUserByUsername, listUsersForAdmin, type AuthUser } from '../db/users';
import { reviewRounds, reviewFingerprint, revisionBlockers, reviewEvidenceBlockers } from '../db/internal-reviews';
import { listProjectTasks } from '../db/project-tasks';
import { skeletonProjectSnapshot } from './skeleton-record';
import { isDeepStrictEqual } from 'node:util';
import { submissionTimeline } from '../projects/workflow';

type Notice = { key:string; projectId:string; username:string; title:string; body:string };
const pool=()=>createPostgresClient().pool;

export async function projectSubmissionNotices(projectId:string,now=new Date()):Promise<Notice[]> {
  const row=(await pool().query(`SELECT p.owner_username,p.pdra_username,p.pi_username,p.lifecycle,s.id::text,s.plan,s.result
    FROM project_records p JOIN project_submissions s ON s.project_id=p.id AND s.is_current WHERE p.id=$1`,[projectId])).rows[0];
  if(!row||row.lifecycle!=='active'||row.result.outcome&&row.result.outcome!=='planned')return [];
  const owner=await getUserByUsername(row.owner_username);if(!owner||owner.provisioningStatus!=='active')return [];
  const project=await getProjectForUser(projectId,owner);
  const profile=(await pool().query('SELECT revision FROM project_research WHERE project_id=$1',[projectId])).rows[0];
  const round=(await reviewRounds(projectId))[0];
  const valid=round&&round.submissionId===row.id&&round.data.profileRevision===(profile?.revision||0)&&isDeepStrictEqual(round.data.projectSnapshot,skeletonProjectSnapshot(project));
  const tasks=await listProjectTasks(projectId);
  const fingerprint=round?reviewFingerprint(round,tasks):null;
  const locked=Boolean(valid&&round.data.lock?.fingerprint===fingerprint&&!revisionBlockers(round,tasks).length&&!(await reviewEvidenceBlockers(projectId,round,tasks)).length);
  const cleared=locked&&round.data.clearance?.fingerprint===fingerprint&&round.data.clearance?.outcome==='submit';
  const deferred=locked&&round.data.clearance?.fingerprint===fingerprint&&round.data.clearance?.outcome==='defer';
  if(deferred)return [];
  const decisions=(await pool().query('SELECT data FROM project_decisions WHERE project_id=$1 AND submission_id=$2 ORDER BY created_at DESC,id DESC',[projectId,row.id])).rows;
  const completed=(checkpoint:string)=>{
    const decision=decisions.find(d=>d.data.checkpoint===checkpoint)?.data;
    return decision?.outcome==='proceed'&&decision.profileRevision===(profile?.revision||0)&&isDeepStrictEqual(decision.projectSnapshot,skeletonProjectSnapshot(project));
  };
  const piNames=projectPIs(project).length?projectPIs(project):(await listUsersForAdmin()).filter(u=>u.role==='administrator'&&u.provisioningStatus==='active').map(u=>u.username);
  const recipients:Record<string,(string|null)[]>={skeleton_lock:[row.owner_username,row.pdra_username],code_lock:[row.owner_username],internal_review:[row.owner_username],revision_lock:[row.owner_username,row.pdra_username],submission_clearance:piNames.filter((name:string)=>name!==row.owner_username),submission_target:[row.owner_username]};
  const actions:Record<string,string>={skeleton_lock:'T−6 weeks: complete the Skeleton Lock assessment.',code_lock:'T−5 weeks: confirm the Code Lock and agreed experimental scope.',internal_review:'T−4 weeks: submit a versioned manuscript for internal review.',revision_lock:'T−2 weeks: resolve required revisions and obtain PDRA acceptance.',submission_clearance:'T−48 hours: review the Revision Tracker and record final PI clearance.',submission_target:'T−24 hours: submit the approved manuscript and record the submission outcome.'};
  const skeleton=(await checklistCheckpoints(project)).find(item=>item.checkpoint==='skeleton_lock');
  const satisfied:Record<string,boolean>={skeleton_lock:skeleton? skeleton.current&&skeleton.outcome==='proceed':completed('skeleton_lock'),code_lock:completed('code_lock'),internal_review:Boolean(valid),revision_lock:locked,submission_clearance:Boolean(cleared),submission_target:false};
  const deadlineLabel=new Intl.DateTimeFormat('en-GB',{timeZone:row.plan.timezone,dateStyle:'medium',timeStyle:'short'}).format(new Date(row.plan.deadline));
  const notices:Notice[]=[];
  for(const point of submissionTimeline(row.plan)) {
    if(Date.parse(point.at)>now.getTime()||satisfied[point.checkpoint])continue;
    for(const username of new Set(recipients[point.checkpoint].filter(Boolean) as string[]))notices.push({key:`${row.id}:${point.checkpoint}`,projectId,username,title:`${project.title}: ${actions[point.checkpoint].split(':')[0]}`,
      body:`${actions[point.checkpoint]} Deadline: ${deadlineLabel} (${row.plan.timezone}).${point.checkpoint==='submission_clearance'&&!locked?' Revision Lock has not passed; resolve its blockers first.':''}${point.checkpoint==='submission_target'&&!cleared?' Final PI clearance is still required.':''}${now.getTime()>Date.parse(row.plan.deadline)?' The submission deadline has passed; record the outcome or retarget the plan.':''}`});
  }
  if(valid&&Date.parse(round.createdAt)+48*3600000<=now.getTime()&&!Object.values(round.data.reviews).some(r=>r.username===row.pdra_username&&r.versions.length))
    notices.push({key:`${row.id}:${round.id}:review_48h`,projectId,username:row.pdra_username,title:`${project.title}: PDRA review overdue`,body:'The manuscript was submitted more than 48 hours ago. Complete and submit the required Meta-Review.'});
  return notices;
}

export async function runSubmissionReminders(now=new Date()) {
  await ensureProjectTables();
  return withDatabaseTransaction(async()=>{
    await pool().query("SELECT pg_advisory_xact_lock(hashtext('submission-reminders'))");
    const projects=(await pool().query('SELECT DISTINCT project_id::text FROM project_submissions WHERE is_current')).rows;
    let created=0,resolved=0;
    for(const {project_id:projectId} of projects) {
      await pool().query('SELECT id FROM project_records WHERE id=$1 FOR UPDATE',[projectId]);
      const notices=await projectSubmissionNotices(projectId,now);
      const activeIds:string[]=[];
      for(const notice of notices) {
        const recipient=await getUserByUsername(notice.username);
        if(!recipient||recipient.provisioningStatus!=='active'||!recipient.notificationPreferences.project_progress_reminders.web)continue;
        try{await getProjectForUser(projectId,recipient);}catch{continue;}
        const inserted=await pool().query(`INSERT INTO submission_notifications(project_id,recipient_user_id,event_key,title,body,created_at)
          VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(recipient_user_id,event_key) DO NOTHING RETURNING id::text`,[projectId,recipient.id,notice.key,notice.title,notice.body,now.toISOString()]);
        created+=inserted.rowCount||0;
        const current=(await pool().query('SELECT id::text FROM submission_notifications WHERE recipient_user_id=$1 AND event_key=$2',[recipient.id,notice.key])).rows[0];
        activeIds.push(current.id);
        // A reopened requirement is the same notice, not a repeated notification on every scheduler tick.
        await pool().query('UPDATE submission_notifications SET resolved_at=NULL,title=$2,body=$3 WHERE id=$1',[current.id,notice.title,notice.body]);
      }
      resolved+=(await pool().query(`UPDATE submission_notifications SET resolved_at=$3,read_at=COALESCE(read_at,$3)
        WHERE project_id=$1 AND NOT(id=ANY($2::uuid[])) AND resolved_at IS NULL`,[projectId,activeIds,now.toISOString()])).rowCount||0;
    }
    return {created,resolved};
  });
}

export async function listSubmissionNotifications(user:AuthUser) {
  await ensureProjectTables();
  if(!user.notificationPreferences.project_progress_reminders.web)return [];
  const rows=(await pool().query(`SELECT id::text,project_id::text AS "projectId",event_key,title,body,read_at::text AS "readAt",created_at::text AS "createdAt",resolved_at::text
    FROM submission_notifications WHERE recipient_user_id=$1 ORDER BY created_at DESC LIMIT 100`,[user.id])).rows;
  const access=new Map<string,Set<string>|null>();
  for(const projectId of new Set(rows.map(r=>r.projectId as string))) {
    try{await getProjectForUser(projectId,user);access.set(projectId,new Set((await projectSubmissionNotices(projectId)).filter(n=>n.username===user.username).map(n=>n.key)));}
    catch{access.set(projectId,null);}
  }
  return rows.filter(row=>access.get(row.projectId)).map(row=>{
    const resolved=!access.get(row.projectId)!.has(row.event_key);
    return {id:row.id,type:'internal_review' as const,projectId:row.projectId,title:row.title,body:row.body,sessionId:null,feedbackId:null,
      actorUserId:user.id,actorUsername:'',actorDisplayName:'Submission schedule',readAt:row.readAt||(resolved?new Date().toISOString():null),createdAt:row.createdAt,resolved};
  });
}
export async function markSubmissionNotificationsRead(user:AuthUser,id?:string,all=false) {
  await ensureProjectTables();
  if(all)await pool().query('UPDATE submission_notifications SET read_at=COALESCE(read_at,now()) WHERE recipient_user_id=$1',[user.id]);
  else if(id)await pool().query('UPDATE submission_notifications SET read_at=COALESCE(read_at,now()) WHERE recipient_user_id=$1 AND id::text=$2',[user.id,id]);
}
