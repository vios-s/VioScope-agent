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
  for (const [name,role] of [['alice','member'],['bob','member'],['carol','member'],['outsider','member'],['principal','pi'],['otherpi','pi'],['admincheck','administrator']]) {
    await db.pool.query(`INSERT INTO users(id,username,display_name,email,role,provisioning_status,password_reset_required) VALUES($1,$2,$3,$4,$5,'active',false)`, [randomUUID(),name,name==='outsider'?'bob':name,`${name}@example.test`,role]);
  }
  const accounts = new Map(await Promise.all(['alice','bob','carol','outsider','principal','otherpi','admincheck'].map(async name => [name,(await users.getUserByUsername(name))!] as const)));
  const projectDb = await import('../src/mastra/db/projects');
  await assert.rejects(projectDb.createProject({title:'Invalid PI', piUsername:'bob'},accounts.get('alice')!),/PI must/);
  await assert.rejects(projectDb.createProject({title:'Self review', pdraUsername:'alice'},accounts.get('alice')!),/own PDRA/);
  const early = await projectDb.createProject({title:'Synthetic early-stage project', stage:2, piUsername:'principal', pdraUsername:'bob'},accounts.get('alice')!);
  let project = await projectDb.createProject({title:'Synthetic bound skeleton', stage:4, piUsername:'principal', pdraUsername:'bob',collaborators:['carol'],venue:'Fictional venue',submissionDeadline:'2026-12-15'},accounts.get('alice')!);
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
  const decide = (name:string,revision:number,kind='pdra',outcome='CLEARED',note='I reviewed the supplied evidence and explain the required follow-up.',extra:Record<string,unknown>={}) => route.PATCH(new Request('http://localhost/review',{method:'PATCH',headers:headers(name),body:JSON.stringify({kind,outcome,note,revision,confirmed:true,...extra})}),context);
  const londonDay=(offset:number)=>new Date(Date.parse(`${new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London'}).format(new Date())}T00:00:00Z`)+offset*86400000).toISOString().slice(0,10);
  async function ok(response:Response){assert.equal(response.status,200,await response.clone().text());return response.json();}
  assert.equal((await listRoute.GET(new Request('http://localhost/reviews'))).status,401);
  // Stage gate: new checks only at stage 4; the route refuses before any AI call and the save path refuses too.
  const post=(projectId:string)=>{const form=new FormData();form.set('projectId',projectId);form.set('mode','paste');form.set('text','Synthetic outline.');return listRoute.POST(new Request('http://localhost/reviews',{method:'POST',headers:{cookie:headers('alice').cookie},body:form}));};
  const gated=await post(early.id);assert.equal(gated.status,400);assert.match((await gated.json()).error,/opens at stage 4 \(Pre-Submission\).*currently at stage 2/);
  await assert.rejects(records.saveSkeletonReview(early.id,skeletonProjectSnapshot(early),'Synthetic evidence',result,accounts.get('alice')!),/opens at stage 4/);
  assert.equal((await projectDb.getProjectForUser(early.id,accounts.get('alice')!)).stage,2,'The gate never changes the project stage.');
  assert.equal((await get('outsider')).status,400);await ok(await get('carol'));await ok(await get('bob'));
  assert.equal((await decide('alice',0)).status,403);assert.equal((await decide('principal',0)).status,403);
  assert.equal((await decide('principal',0,'pi','approved')).status,400);
  assert.equal((await decide('bob',0,'pdra','CLEARED','')).status,400);
  for (const legacy of ['locked','conditional','revise']) assert.equal((await decide('bob',0,'pdra',legacy)).status,400,`New writes reject legacy ${legacy}.`);
  assert.equal((await decide('bob',0,'pdra','CONDITIONAL')).status,400,'CONDITIONAL needs a re-evaluation date.');
  assert.equal((await decide('bob',0,'pdra','CONDITIONAL',undefined,{reevaluateOn:londonDay(0)})).status,400,'The date must be after today in Europe/London.');
  assert.equal((await decide('bob',0,'pdra','CLEARED',undefined,{reevaluateOn:londonDay(3)})).status,400);
  let saved = (await ok(await decide('bob',0))).review;
  assert.equal(saved.revision,1);assert.equal(saved.decisions[0].by,'bob');
  assert.equal((await decide('bob',0)).status,409);
  saved=(await ok(await decide('principal',1,'pi','approved'))).review;
  assert.equal(latestSkeletonDecisions(saved.decisions).pi?.outcome,'approved');
  saved=(await ok(await decide('bob',2,'pdra','SLIDE'))).review;
  assert.equal(latestSkeletonDecisions(saved.decisions).pi,null,'Changed PDRA verdict invalidates earlier final approval.');
  assert.equal(saved.decisions.length,3,'Human decision history is retained.');
  assert.equal((await decide('principal',3,'pi','approved')).status,400,'PI cannot confirm the lock after a SLIDE verdict.');
  saved=(await ok(await decide('bob',3,'pdra','CONDITIONAL',undefined,{reevaluateOn:londonDay(3)}))).review;
  assert.equal(saved.decisions[3].reevaluateOn,londonDay(3));assert.equal(saved.decisions[3].outcome,'CONDITIONAL');
  // Legacy PDRA codes stored before the verdict change still load and keep their PI rules.
  await db.pool.query(`UPDATE skeleton_reviews SET decisions=decisions || '[{"kind":"pdra","outcome":"revise","note":"Legacy","by":"bob","at":"2026-10-01T10:00:00.000Z"}]'::jsonb,revision=revision+1 WHERE id=$1`,[review.id]);
  saved=(await ok(await get('carol'))).review;assert.equal(latestSkeletonDecisions(saved.decisions).pdra?.outcome,'revise');
  assert.match(await (await decide('principal',5,'pi','approved')).text(),/PDRA requested revision/);
  // Existing reviews stay completable after the project leaves stage 4.
  await projectDb.updateProject(project.id,{stage:5},accounts.get('alice')!);
  saved=(await ok(await decide('bob',5,'pdra','CLEARED'))).review;
  saved=(await ok(await decide('principal',6,'pi','approved'))).review;assert.equal(latestSkeletonDecisions(saved.decisions).pi?.outcome,'approved');
  await assert.rejects(records.saveSkeletonReview(project.id,skeletonProjectSnapshot(await projectDb.getProjectForUser(project.id,accounts.get('alice')!)),'New evidence',result,accounts.get('alice')!),/currently at stage 5/);
  await projectDb.updateProject(project.id,{stage:4},accounts.get('alice')!);
  const second=await records.saveSkeletonReview(project.id,skeletonProjectSnapshot(project),'New synthetic evidence',result,accounts.get('alice')!);
  assert.deepEqual(second.decisions,[]);assert.equal((await decide('bob',7)).status,409,'Old versions cannot be confirmed.');
  await projectDb.updateProject(project.id,{pdraUsername:'outsider'},accounts.get('alice')!);
  assert.equal((await get('bob')).status,400,'Reassignment revokes non-collaborator PDRA access.');
  await assert.rejects(records.decideSkeletonReview(second.id,{kind:'pdra',outcome:'CLEARED',note:'A note',revision:0,confirmed:true},accounts.get('outsider')!),/Project details changed/);
  project=await projectDb.getProjectForUser(project.id,accounts.get('alice')!);
  await assert.rejects(records.saveSkeletonReview(project.id,{...skeletonProjectSnapshot(project),venue:'Forged'},'Evidence',result,accounts.get('alice')!),/Project details changed/);
  const listing=await records.listSkeletonReviews(accounts.get('outsider')!);assert.equal(listing.reviews.length,2);
  assert.equal((await records.listSkeletonReviews(accounts.get('bob')!)).reviews.length,0);
  assert.equal(project.stage,4,'Human judgments do not change project stage.');
  if(process.env.CHECK_SKELETON_PROJECT_UI==='true') {
    const {checkSkeletonProjectUi}=await import('./lib/skeleton-project-ui');
    await projectDb.updateProject(project.id,{pdraUsername:'bob'},accounts.get('alice')!);
    const current=await projectDb.getProjectForUser(project.id,accounts.get('alice')!);
    const {normalizePaperSkeleton}=await import('../src/mastra/submission/review');
    const source=`## Abstract\n${'synthetic '.repeat(180)}\n## Introduction\nSynthetic source evidence`;
    const withChecklist={...result,structured:{...result.structured,paperSkeleton:normalizePaperSkeleton([{id:'abstract',status:'partly',evidence:'Synthetic source evidence'}],source)}};
    const fresh=await records.saveSkeletonReview(project.id,skeletonProjectSnapshot(current),source,withChecklist,accounts.get('alice')!);
    await checkSkeletonProjectUi(sessionCookieName,{owner:createSessionToken(accounts.get('alice')!),pdra:createSessionToken(accounts.get('bob')!),pi:createSessionToken(accounts.get('principal')!)},project.id,fresh.id);
  }
  // Separation of duties: owners never judge their own project; one person never records both steps; admins act only by labelled override.
  const judge=(id:string,name:string,kind:'pdra'|'pi',outcome:string,revision:number,override=false)=>records.decideSkeletonReview(id,{kind,outcome,note:'Synthetic evidence-based judgment.',revision,confirmed:true,...(override?{override:true}:{})},accounts.get(name)!);
  const adminOwned=await projectDb.createProject({title:'Synthetic admin-owned skeleton',stage:4,piUsername:'principal',pdraUsername:'bob'},accounts.get('admincheck')!);
  const adminReview=await records.saveSkeletonReview(adminOwned.id,skeletonProjectSnapshot(adminOwned),'Synthetic evidence',result,accounts.get('admincheck')!);
  await assert.rejects(judge(adminReview.id,'admincheck','pdra','CLEARED',0,true),/project owner cannot/,'An administrator owner cannot judge their own project.');
  await assert.rejects(judge(adminReview.id,'admincheck','pi','approved',0,true),/project owner cannot/);
  const pairProject=await projectDb.createProject({title:'Synthetic separated skeleton',stage:4,piUsername:'principal',pdraUsername:'bob'},accounts.get('alice')!);
  const pair=await records.saveSkeletonReview(pairProject.id,skeletonProjectSnapshot(pairProject),'Synthetic evidence',result,accounts.get('alice')!);
  await assert.rejects(judge(pair.id,'admincheck','pdra','CLEARED',0),/explicit administrator override/,'Administrators need an explicit override.');
  await assert.rejects(judge(pair.id,'otherpi','pdra','CLEARED',0,true),/explicit administrator override/,'Only administrators can override.');
  let paired=await judge(pair.id,'admincheck','pdra','CLEARED',0,true);
  assert.equal(paired.decisions[0].override,true,'The override is recorded with the decision.');
  await assert.rejects(judge(pair.id,'otherpi','pi','approved',1),/Only the project PI/,'A PI of another project cannot confirm.');
  await assert.rejects(judge(pair.id,'admincheck','pi','approved',1,true),/another person must record the PI confirmation/,'One person cannot record both steps.');
  paired=await judge(pair.id,'principal','pi','approved',1);
  assert.equal(paired.decisions[1].override,undefined);
  assert.equal(latestSkeletonDecisions(paired.decisions).pi?.outcome,'approved');
  await assert.rejects(judge(pair.id,'principal','pdra','SLIDE',2,true),/explicit administrator override|another person/);
  console.log('Project-bound Skeleton Lock passed: inherited identity/context, stage-4 gate for new checks, CLEARED/CONDITIONAL/SLIDE with future re-evaluation dates, legacy PDRA records, completion after a stage change, independent PDRA/PI judgments, owner exclusion, project-PI-only confirmation, labelled administrator override, one person per step, evidence history, stale revisions, new AI versions, reassignment and access revocation.');
}finally {
  await closePostgresPools(process.env.DATABASE_URL);
  if(created)await source.pool.query(`DROP DATABASE "${database}" WITH (FORCE)`);
  await closePostgresPools(original);await rm(directory,{recursive:true,force:true});
}
