import { createHash } from 'node:crypto';
import { createPostgresClient, withDatabaseTransaction } from './postgres';
import type { ProjectTask, TaskData } from '../projects/workflow';
import type { ProjectTodoRecord } from './projects';
import type { MeetingAction } from '../theme-meetings/workflow';
import { AuthError } from '../auth/session';

function legacyTaskId(projectId:string,id:string) { const h=createHash('sha256').update(projectId+':'+id).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`; }

export const taskColumns = `id::text,project_id::text AS "projectId",source_kind AS "sourceKind",source_id AS "sourceId",revision,data`;
export async function listProjectTasks(projectId: string): Promise<ProjectTask[]> {
 return (await createPostgresClient().pool.query(`SELECT ${taskColumns} FROM project_tasks WHERE project_id=$1 ORDER BY created_at,id`,[projectId])).rows;
}
// The old JSON field is an intake for backwards-compatible writes, never a second task store.
export async function importProjectTodos(projectId:string) {
 return withDatabaseTransaction(async()=>{
  const db=createPostgresClient();
  const row=(await db.pool.query("SELECT todos,owner_username FROM project_records WHERE id=$1 AND todos<>'[]'::jsonb FOR UPDATE",[projectId])).rows[0];
  if(!row)return;
  for(const todo of row.todos as ProjectTodoRecord[]){
   const data:TaskData={task:todo.text,owner:row.owner_username,dueDate:todo.dueDate,status:todo.done?'done':'open',priority:'normal',note:'Imported project task.',evidenceIds:[],history:[{by:row.owner_username,at:todo.updatedAt,status:todo.done?'done':'open',note:'Imported project task.'}]};
   await db.pool.query(`INSERT INTO project_tasks(id,project_id,source_kind,data) VALUES($1,$2,'project',$3::jsonb) ON CONFLICT(id) DO NOTHING`,[legacyTaskId(projectId,todo.id),projectId,JSON.stringify(data)]);
  }
  await db.pool.query("UPDATE project_records SET todos='[]'::jsonb WHERE id=$1",[projectId]);
 });
}
export async function replaceLegacyProjectTodos(projectId:string,todos:ProjectTodoRecord[],by:string) {
 const db=createPostgresClient();
 // Existing project task IDs cannot be reused to overwrite a meeting/review task or another project.
 const rows=await listProjectTasks(projectId);
 const supplied=new Set(todos.map(todo=>todo.id));
 for(const row of rows.filter(row=>row.sourceKind==='project'&&!supplied.has(row.id))) {
  await db.pool.query('UPDATE project_tasks SET data=$2::jsonb,revision=revision+1 WHERE id=$1',[row.id,JSON.stringify({...row.data,status:'cancelled',history:[...row.data.history,{by,at:new Date().toISOString(),status:'cancelled',note:'Removed through project task editor.'}]})]);
 }
 for(const todo of todos){
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(todo.id))throw new Error('Task IDs must be valid UUIDs. Reload the project before editing.');
  const current=(await db.pool.query(`SELECT ${taskColumns} FROM project_tasks WHERE id=$1 FOR UPDATE`,[todo.id])).rows[0] as ProjectTask|undefined;
  if(current && (current.projectId!==projectId||current.sourceKind!=='project'))throw new Error('This task is managed through the project workflow.');
  if(todo.done&&current?.data.status!=='done')throw new Error('Complete tasks in the project workflow with a completion note and evidence.');
  const status=todo.done?'done':'open';
  const data:TaskData={...(current?.data||{}),task:todo.text,owner:current?.data.owner||by,dueDate:todo.dueDate,status,priority:current?.data.priority||'normal',note:current?.data.note||'',evidenceIds:current?.data.evidenceIds||[],history:[...(current?.data.history||[]),{by,at:new Date().toISOString(),status,note:'Updated through project task editor.'}]};
  await db.pool.query(`INSERT INTO project_tasks(id,project_id,source_kind,data) VALUES($1,$2,'project',$3::jsonb) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data,revision=project_tasks.revision+1`,[todo.id,projectId,JSON.stringify(data)]);
 }
}
export function taskAsTodo(task:ProjectTask):ProjectTodoRecord {
 const history=task.data.history;
 return {id:task.id,text:task.data.task,dueDate:task.data.dueDate,done:task.data.status==='done',createdAt:history[0]?.at||'',updatedAt:history.at(-1)?.at||''};
}
export function taskAsMeetingAction(task:ProjectTask):MeetingAction {
 return {id:task.id,projectId:task.projectId,themeId:task.data.themeId!,meetingDate:task.data.meetingDate!,decision:task.data.decision!,task:task.data.task,owner:task.data.owner,dueDate:task.data.dueDate!,status:task.data.status==='done'?'done':'open',note:task.data.note,history:task.data.history.map(item=>({...item,status:item.status==='done'?'done':'open'}))};
}
export async function importMeetingTasks(path:string,actions:MeetingAction[]) {
 const db=createPostgresClient();
 await withDatabaseTransaction(async()=>{
  await db.pool.query('SELECT pg_advisory_xact_lock(hashtext($1))',['meeting-task-import:'+path]);
  if((await db.pool.query('SELECT 1 FROM meeting_task_imports WHERE path=$1',[path])).rowCount)return;
  for(const action of actions)await insertMeetingTask(action,path);
  await db.pool.query('INSERT INTO meeting_task_imports(path) VALUES($1)',[path]);
 });
}
export async function insertMeetingTask(action:MeetingAction,path:string) {
 const {id,projectId,...data}=action;
 await createPostgresClient().pool.query(`INSERT INTO project_tasks(id,project_id,source_kind,source_id,data) VALUES($1,$2,'meeting',$4,$3::jsonb) ON CONFLICT(id) DO NOTHING`,[id,projectId,JSON.stringify({...data,priority:'normal',evidenceIds:[]}),path]);
}
export async function readMeetingTasks(path:string):Promise<MeetingAction[]> {
 const rows=(await createPostgresClient().pool.query(`SELECT ${taskColumns} FROM project_tasks WHERE source_kind='meeting' AND source_id=$1 ORDER BY created_at,id`,[path])).rows as ProjectTask[];
 return rows.map(taskAsMeetingAction);
}
export async function saveMeetingTaskChanges(before:MeetingAction[],after:MeetingAction[],path:string) {
 const db=createPostgresClient();
 for(const action of after){
  const previous=before.find(item=>item.id===action.id);
  if(!previous){await insertMeetingTask(action,path);continue;}
  if(JSON.stringify(previous)===JSON.stringify(action))continue;
  const task=(await db.pool.query(`SELECT ${taskColumns} FROM project_tasks WHERE id=$1 FOR UPDATE`,[action.id])).rows[0] as ProjectTask;
  if(JSON.stringify(taskAsMeetingAction(task))!==JSON.stringify(previous))throw new AuthError('This task changed. Reload before saving.',409,'conflict');
  const {id:_,projectId:__,...data}=action;
  await db.pool.query('UPDATE project_tasks SET data=$2::jsonb,revision=revision+1 WHERE id=$1',[action.id,JSON.stringify({...task.data,...data,history:[...task.data.history,...data.history.slice(previous.history.length)]})]);
 }
}
