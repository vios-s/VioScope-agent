import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPostgresClient, closePostgresPools } from '../src/mastra/db/postgres';
import type { SubmissionReviewResult } from '../src/mastra/submission/review';
const original = process.env.DATABASE_URL!;
const source = createPostgresClient('skeleton-project-isolation');
const database = `skeleton_${randomUUID().replaceAll('-','')}`;
const directory = await mkdtemp(join(tmpdir(), 'skeleton-project-')); let created = false;
try {
  await source.pool.query(`CREATE DATABASE "${database}"`); created = true;
  const url = new URL(original); url.pathname = '/'+database;
  Object.assign(process.env, { DATABASE_URL: url.toString(), DATASTORE_DIR: directory, AUTH_SECRET: 'synthetic-skeleton-session', VIOSCOPE_RUNTIME_CONFIG_CACHE_PATH: join(directory,'runtime.json'), THEME_MEETING_CONFIG_PATH: join(directory,'themes.yaml') });
  await writeFile(join(directory,'themes.yaml'), 'timezone: Europe/London\ncycle:\n  rotation: [AB]\n  anchor_date: 2026-10-28\nthemes:\n  - theme_id: A\n    title: Synthetic theme\n    cycle_group: AB\n    time: "10:00"\n    coordinator: principal\n    coordinator_user: principal\n    members: [alice, bob]\n    member_users: [alice, bob]\n');
  const users = await import('../src/mastra/db/users'); await users.ensureUsersTable();
  const db = createPostgresClient();
  for (const [name,role] of [['alice','member'],['bob','member'],['carol','member'],['outsider','member'],['principal','pi'],['admincheck','administrator']]) {
    await db.pool.query(`INSERT INTO users(id,username,display_name,email,role,provisioning_status,password_reset_required) VALUES($1,$2,$3,$4,$5,'active',false)`, [randomUUID(),name,name==='outsider'?'bob':name,`${name}@example.test`,role]);
  }
  const accounts = new Map(await Promise.all(['alice','bob','carol','outsider','principal','admincheck'].map(async name => [name,(await users.getUserByUsername(name))!] as const)));
  const projectDb = await import('../src/mastra/db/projects');
  await assert.rejects(projectDb.createProject({title:'Invalid PI', piUsername:'bob'},accounts.get('alice')!),/PI must/);
  await assert.rejects(projectDb.createProject({title:'Self review', pdraUsername:'alice'},accounts.get('alice')!),/own PDRA/);
  let project = await projectDb.createProject({title:'Synthetic bound skeleton', piUsername:'principal', pdraUsername:'bob',collaborators:['carol'],venue:'Fictional venue',submissionDeadline:'2026-12-15'},accounts.get('alice')!);
  assert.equal(project.piUsername,'principal');assert.equal(project.pdraUsername,'bob');
  assert.equal((await projectDb.getProjectForUser(project.id,accounts.get('bob')!)).access.canEdit,false);
  await assert.rejects(projectDb.getProjectForUser(project.id,accounts.get('outsider')!),/access denied/);
  const records = await import('../src/mastra/db/skeleton-reviews');
  const { skeletonProjectSnapshot,latestSkeletonDecisions } = await import('../src/mastra/submission/skeleton-record');
  const result: SubmissionReviewResult = { report:'Synthetic AI evidence check', draftName:'Synthetic outline', draftTruncated:false,draftChars:15,finishReason:'stop',skills:[],structured:{verdict:'CONDITIONAL',summary:'Synthetic: evidence needs work.',appliedSkills:[],findings:[{area:'Baseline',status:'missing',evidence:['missing'],gap:'No baseline results.',requiredAction:'Add results.'}],reasonsToReject:[],checkmateQuestions:[],mitigations:[],humanSignOff:{leadPdra:'pending',piOrOrganizer:'pending',remainingEvidenceNeeded:[]},perSkillNotes:[]} };
  await assert.rejects(records.saveSkeletonReview(project.id,skeletonProjectSnapshot(project),'Synthetic evidence',result,accounts.get('carol')!),/Only the project owner/);
  const review = await records.saveSkeletonReview(project.id,skeletonProjectSnapshot(project),'Synthetic evidence',result,accounts.get('alice')!);
  assert.equal(review.projectSnapshot.ownerUsername,'alice');assert.deepEqual(review.projectSnapshot.collaborators,['carol']);assert.equal(review.projectSnapshot.submissionDeadline,'2026-12-15');
  const {createSessionToken,sessionCookieName} = await import('../src/mastra/auth/session');
  const route = await import('../app/api/skeleton-lock/[reviewId]/route');
  const listRoute = await import('../app/api/skeleton-lock/route');
  const headers = (name:string) => ({'content-type':'application/json',cookie:`${sessionCookieName}=${createSessionToken(accounts.get(name)!)}`});
  const context = {params:Promise.resolve({reviewId:review.id})};
  const get = (name:string) => route.GET(new Request('http://localhost/review',{headers:headers(name)}),context);
  const decide = (name:string,revision:number,kind='pdra',outcome='locked',note='I reviewed the supplied evidence and explain the required follow-up.') => route.PATCH(new Request('http://localhost/review',{method:'PATCH',headers:headers(name),body:JSON.stringify({kind,outcome,note,revision,confirmed:true})}),context);
  async function ok(response:Response){assert.equal(response.status,200,await response.clone().text());return response.json();}
  assert.equal((await listRoute.GET(new Request('http://localhost/reviews'))).status,401);
  assert.equal((await get('outsider')).status,400);await ok(await get('carol'));await ok(await get('bob'));
  assert.equal((await decide('alice',0)).status,403);assert.equal((await decide('principal',0)).status,403);
  assert.equal((await decide('principal',0,'pi','approved')).status,400);
  assert.equal((await decide('bob',0,'pdra','locked','')).status,400);
  let saved = (await ok(await decide('bob',0))).review;
  assert.equal(saved.revision,1);assert.equal(saved.decisions[0].by,'bob');
  assert.equal((await decide('bob',0)).status,409);
  saved=(await ok(await decide('principal',1,'pi','approved'))).review;
  assert.equal(latestSkeletonDecisions(saved.decisions).pi?.outcome,'approved');
  saved=(await ok(await decide('bob',2,'pdra','revise'))).review;
  assert.equal(latestSkeletonDecisions(saved.decisions).pi,null,'Changed PDRA verdict invalidates earlier final approval.');
  assert.equal(saved.decisions.length,3,'Human decision history is retained.');
  assert.equal((await decide('principal',3,'pi','approved')).status,400);
  const second=await records.saveSkeletonReview(project.id,skeletonProjectSnapshot(project),'New synthetic evidence',result,accounts.get('alice')!);
  assert.deepEqual(second.decisions,[]);assert.equal((await decide('bob',3)).status,409,'Old versions cannot be confirmed.');
  await projectDb.updateProject(project.id,{pdraUsername:'outsider'},accounts.get('alice')!);
  assert.equal((await get('bob')).status,400,'Reassignment revokes non-collaborator PDRA access.');
  await assert.rejects(records.decideSkeletonReview(second.id,{kind:'pdra',outcome:'locked',note:'A note',revision:0,confirmed:true},accounts.get('outsider')!),/Project details changed/);
  project=await projectDb.getProjectForUser(project.id,accounts.get('alice')!);
  await assert.rejects(records.saveSkeletonReview(project.id,{...skeletonProjectSnapshot(project),venue:'Forged'},'Evidence',result,accounts.get('alice')!),/Project details changed/);
  const listing=await records.listSkeletonReviews(accounts.get('outsider')!);assert.equal(listing.reviews.length,2);
  assert.equal((await records.listSkeletonReviews(accounts.get('bob')!)).reviews.length,0);
  assert.equal(project.stage,1,'Human judgments do not change project stage.');
  if(process.env.CHECK_SKELETON_PROJECT_UI==='true') {
    const {checkSkeletonProjectUi}=await import('./lib/skeleton-project-ui');
    await projectDb.updateProject(project.id,{pdraUsername:'bob'},accounts.get('alice')!);
    const current=await projectDb.getProjectForUser(project.id,accounts.get('alice')!);
    const fresh=await records.saveSkeletonReview(project.id,skeletonProjectSnapshot(current),'Synthetic source evidence',result,accounts.get('alice')!);
    await checkSkeletonProjectUi(sessionCookieName,{owner:createSessionToken(accounts.get('alice')!),pdra:createSessionToken(accounts.get('bob')!),pi:createSessionToken(accounts.get('principal')!)},project.id,fresh.id);
  }
  console.log('Project-bound Skeleton Lock passed: inherited identity/context, independent PDRA/PI judgments, evidence history, stale revisions, new AI versions, reassignment and access revocation.');
}finally {
  await closePostgresPools(process.env.DATABASE_URL);
  if(created)await source.pool.query(`DROP DATABASE "${database}" WITH (FORCE)`);
  await closePostgresPools(original);await rm(directory,{recursive:true,force:true});
}
