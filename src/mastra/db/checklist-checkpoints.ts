import { isDeepStrictEqual } from 'node:util';
import { createPostgresClient } from './postgres';
import type { ProjectRecord } from './projects';
import { latestSkeletonDecisions, skeletonProjectSnapshot, type SkeletonDecision } from '../submission/skeleton-record';
export type ChecklistCheckpoint = { checkpoint:'idea_lock'|'skeleton_lock'; outcome:string; by:string; at:string; note:string; version:string; current:boolean };
/** Read existing human decisions only; never manufacture an approval or write a duplicate checkpoint. Caller must authorize the project. */
export async function checklistCheckpoints(project:ProjectRecord):Promise<ChecklistCheckpoint[]> {
 const db=createPostgresClient();
 const available=(await db.pool.query("SELECT to_regclass('project_idea_origins') AS idea,to_regclass('skeleton_reviews') AS skeleton")).rows[0];
 const research=(await db.pool.query('SELECT revision,history FROM project_research WHERE project_id=$1',[project.id])).rows[0];
 const items:ChecklistCheckpoint[]=[];
 if(available.idea){
  const origin=(await db.pool.query('SELECT snapshot FROM project_idea_origins WHERE project_id=$1',[project.id])).rows[0]?.snapshot;
  if(origin?.decision?.outcome==='proceed')items.push({checkpoint:'idea_lock',outcome:'proceed',by:origin.approvedBy,at:origin.approvedAt,note:origin.decision.reason||origin.decision.evidence||origin.decision.nextMilestone||'',version:`Idea Pitch v${origin.version}`,current:!research?.revision});
 }
 if(available.skeleton){
  const review=(await db.pool.query('SELECT id,revision,created_at,project_snapshot,decisions FROM skeleton_reviews WHERE project_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1',[project.id])).rows[0];
  if(review){
   const decisions=review.decisions as SkeletonDecision[];
   const latest=latestSkeletonDecisions(decisions), recorded=latest.pi||decisions.findLast(item=>item.kind==='pi');
   const submission=(await db.pool.query('SELECT created_at FROM project_submissions WHERE project_id=$1 AND is_current',[project.id])).rows[0];
   const changedAt=research?.history?.at(-1)?.at;
   const current=Boolean(latest.pi&&isDeepStrictEqual(review.project_snapshot,skeletonProjectSnapshot(project))&&(!changedAt||Date.parse(changedAt)<=new Date(review.created_at).getTime())&&(!submission||new Date(submission.created_at).getTime()<=new Date(review.created_at).getTime()));
   items.push({checkpoint:'skeleton_lock',outcome:recorded?(recorded.outcome==='approved'?'proceed':'revise'):'pending',by:recorded?.by||'',at:recorded?.at||new Date(review.created_at).toISOString(),note:recorded?.note||'Awaiting human confirmation in Checklists → Skeleton Lock.',version:`Skeleton Lock r${review.revision}`,current});
  }
 }
 return items;
}
