import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium,getFreePort,startNextServer,waitForServer,stopServer } from './playwright-smoke';
export async function checkProjectWorkflowUi(cookieName:string,token:string,projectId:string,piToken:string){
 const port=await getFreePort(),base=`http://127.0.0.1:${port}`,output=resolve('.local/checks/workflow-simplify');await mkdir(output,{recursive:true});
 const server=startNextServer({port,mode:'start',env:{...process.env,EMAIL_NOTIFICATIONS_ENABLED:'false'}});let browser;
 try{
  await waitForServer(server,base,480);browser=await chromium.launch();
  const context=await browser.newContext({viewport:{width:1440,height:1000}});await context.addCookies([{name:cookieName,value:token,url:base}]);
  const page=await context.newPage(),errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(15000);
  await page.addLocatorHandler(page.locator('.welcome-dialog'),async()=>{await page.getByLabel('Close welcome message').click();});
  await page.route('**/api/theme-meetings',route=>route.fulfill({json:{plan:null,notifications:[],users:[],access:{canManageThemeIds:[]},source:'unconfigured'}}));
  const get=async()=>await(await page.request.get(base+`/api/projects/${projectId}/workflow`)).json();
  await page.goto(base+'/?view=projects');await page.getByLabel('Project details for Synthetic bound skeleton',{exact:true}).click();
  const nav=page.getByRole('tablist',{name:'Project record sections'});await nav.getByRole('tab',{name:'Details',exact:true}).click();
  const panel=page.getByRole('region',{name:'Project research workflow'}),tabs=panel.getByRole('tablist',{name:'Workflow records'});
  const tab=async(name:string)=>tabs.getByRole('tab',{name:new RegExp('^'+name+'(?:\\s|$)')}).click();
  const before=await get();await panel.locator('textarea[name=question]').waitFor().catch(async error=>{console.log({errors,body:(await page.locator('body').innerText()).slice(-5000)});await page.screenshot({path:output+'/failure.png'});throw error;});
  assert.equal(await panel.getByLabel('Current work phase',{exact:true}).count(),0);
  await panel.getByText('Resources and approvals',{exact:false}).first().click();
  await panel.getByLabel('Resource notes',{exact:true}).fill('Synthetic resource context retained with the requirements.');
  await panel.getByRole('button',{name:'Add resource or approval requirement'}).click();
  const resource=panel.locator('.workflow-resource').last();
  await resource.getByLabel('Need',{exact:true}).fill('Synthetic compute allocation');
  await resource.locator('select').nth(2).selectOption('alice');
  await resource.getByLabel('Evidence or approval reference',{exact:true}).fill('Synthetic allocation reference.');
  async function capture(name:string){
   for(const width of [1440,768,390]){
    await page.setViewportSize({width,height:1000});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${name}: page overflow`);
    assert.equal(await panel.evaluate(el=>{const box=el.getBoundingClientRect();return [...el.querySelectorAll('input:not([type=hidden]),select,textarea')].every(control=>{const r=control.getBoundingClientRect();return !r.width||(r.left>=box.left-1&&r.right<=box.right+1);});}),true,`${name}: control overflow`);
    await page.screenshot({path:`${output}/${name}-${width}.png`,animations:'disabled'});
   }
   await page.setViewportSize({width:1440,height:1000});
  }
  await resource.scrollIntoViewIfNeeded();
  const legend=await resource.locator('legend').boundingBox(),first=await resource.locator('select').first().boundingBox();
  assert.ok(legend&&first&&first.y>=legend.y+legend.height,'Resource fields start below their legend.');
  const columns=await resource.locator('select').all();
  const left=await columns[0].boundingBox(),right=await columns[1].boundingBox();assert.ok(left&&right&&Math.abs(left.y-right.y)<1,'Resource controls align in the same row.');
  await capture('resources');
  await panel.getByLabel('Reason for this update',{exact:true}).fill('Synthetic browser verification.');
  await panel.getByRole('button',{name:'Save research profile'}).click();await panel.getByRole('status').waitFor();
  const saved=await get();assert.equal(saved.research.profile.phase,before.research.profile.phase);assert.equal(saved.research.profile.resources.at(-1).need,'Synthetic compute allocation');assert.match(saved.research.profile.resourceNotes,/retained/);
  await tab('Tasks');await panel.getByText('Add a task',{exact:true}).click();
  const form=panel.locator('form').filter({has:page.getByRole('button',{name:'Create project task'})});
  await form.getByLabel('Task',{exact:true}).fill('Synthetic browser follow-up');await form.locator('select[name=owner]').selectOption('alice');
  assert.equal(await form.locator('select[name=owner] option[value=outsider]').count(),0);
  await capture('task-create');await form.getByRole('button',{name:'Create project task'}).click();
  const row=panel.locator('article').filter({has:page.getByRole('heading',{name:'Synthetic browser follow-up',exact:true})});await row.getByText('Update task and completion evidence',{exact:true}).click();
  await row.locator('select[name=status]').selectOption('done');await row.getByLabel('Progress or completion evidence',{exact:true}).fill('Verified in the synthetic browser test.');await capture('task-update');await row.getByRole('button',{name:'Save task progress'}).click();await row.getByText(/Done · Due/).waitFor();
  assert.equal((await get()).tasks.find((t:any)=>t.data.task==='Synthetic browser follow-up').data.status,'done');
  await tab('Evidence');await panel.getByText('Add evidence',{exact:true}).click();
  await panel.getByRole('combobox',{name:/^Evidence source/}).selectOption('url');await panel.getByLabel('Evidence URL',{exact:true}).fill('https://example.org/version-2');await panel.getByLabel('Evidence title',{exact:true}).fill('Browser evidence');
  await panel.getByRole('combobox',{name:/^Evidence state/}).selectOption('completed');await panel.getByLabel('Result and interpretation',{exact:true}).fill('Synthetic completed comparison.');await capture('evidence');await panel.getByRole('button',{name:'Save evidence record'}).click();await panel.getByRole('heading',{name:'Browser evidence',exact:true}).waitFor();
  await tab('Submissions');await panel.getByText('Add a submission plan',{exact:true}).click();
  const submission=panel.locator('form').filter({has:page.getByRole('button',{name:'Confirm submission plan'})});
  await submission.getByLabel('Target venue',{exact:true}).fill('Browser venue');await submission.getByLabel('Official deadline (selected timezone)',{exact:true}).fill('2027-07-15T12:00');await submission.getByLabel('Reason for this plan',{exact:true}).fill('Synthetic resubmission.');await capture('submission');await submission.getByRole('button',{name:'Confirm submission plan'}).click();
  await panel.getByRole('heading',{name:/Browser venue/}).waitFor();const newest=(await get()).submissions[0];assert.equal(newest.plan.deadline,'2027-07-15T11:00:00.000Z');
  const current=panel.locator('article').first();await current.getByText('Submission result and reflection',{exact:true}).click();await current.getByRole('combobox',{name:/^Outcome/}).selectOption('submitted');await current.getByLabel('Actual submission time (Europe/London)',{exact:true}).fill('2027-07-14T12:00');await current.getByLabel('Reason for this update',{exact:true}).fill('Synthetic submission.');await capture('submission-result');await current.getByRole('button',{name:'Save submission outcome'}).click();await current.getByText('Outcome: Submitted',{exact:true}).waitFor();
  await tab('Checkpoints');assert.equal(await panel.getByText('Record a checkpoint decision',{exact:true}).count(),0);assert.equal(await panel.locator('.internal-review').count(),0);
  await context.addCookies([{name:cookieName,value:piToken,url:base}]);await page.reload();await page.getByLabel('Project details for Synthetic bound skeleton',{exact:true}).click();await nav.getByRole('tab',{name:'Details',exact:true}).click();await tab('Checkpoints');await panel.getByText('Record a checkpoint decision',{exact:true}).click();
  const decision=panel.locator('form');assert.equal(await decision.getByLabel('Checklist or rules version').count(),0);assert.equal(await decision.locator('option[value=skeleton_lock]').count(),0);
  await decision.getByRole('combobox',{name:/^Checkpoint/}).selectOption('code_lock');await decision.getByRole('combobox',{name:/^Decision/}).selectOption('conditional');await decision.getByLabel('Reason and evidence assessment',{exact:true}).fill('Synthetic remaining checks.');await decision.getByLabel('Required actions or conditions',{exact:true}).fill('Complete the next comparison.');await decision.getByLabel('Re-evaluation date',{exact:true}).fill('2027-07-10');await capture('checkpoint');
  const history=await panel.getByRole('heading',{name:'Checkpoint decisions',exact:true}).boundingBox(),formBox=await decision.boundingBox();assert.ok(history&&formBox&&history.y>=formBox.y+formBox.height,'Checkpoint history follows the form.');
  await decision.getByLabel('I confirm this decision and its recorded evidence.',{exact:true}).check();await decision.getByRole('button',{name:'Record checkpoint decision'}).click();await panel.getByRole('heading',{name:'Code lock · Conditional',exact:true}).waitFor();assert.equal((await get()).decisions[0].data.rulesVersion,'project-checkpoints-v1');
  await nav.getByRole('tab',{name:'Update',exact:true}).click();await page.getByText('Status and classification',{exact:true}).click();await page.getByText('Targets and blockers',{exact:true}).click();await page.setViewportSize({width:390,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:output+'/update-390.png',animations:'disabled'});
  assert.deepEqual(errors,[]);console.log('Workflow UI passed: data preservation, resource alignment, account selection, evidence, local-time submissions, conditional checkpoints, history ordering and all expanded forms at 1440/768/390.');
 }finally{await browser?.close();await stopServer(server);}
}
