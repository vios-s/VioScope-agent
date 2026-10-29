import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium,getFreePort,startNextServer,waitForServer,stopServer } from './playwright-smoke';
export async function checkProjectWorkflowUi(cookieName:string,token:string,projectId:string,piToken:string){
 const port=await getFreePort(),base=`http://127.0.0.1:${port}`;
 const server=startNextServer({port,mode:'start',env:{...process.env,EMAIL_NOTIFICATIONS_ENABLED:'false'}});let browser;
 try{
  await waitForServer(server,base);browser=await chromium.launch();
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  await context.addCookies([{name:cookieName,value:token,url:base}]);
  const page=await context.newPage(),errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addLocatorHandler(page.locator('.welcome-dialog'),async()=>{await page.getByLabel('Close welcome message').click();});
  await page.goto(base+'/?view=projects');
  await page.getByLabel('Project details for Synthetic bound skeleton').click();
  await page.getByRole('button',{name:'Research workflow',exact:true}).click();
  const panel=page.getByRole('region',{name:'Project research workflow'});
  await panel.getByLabel('Research question').waitFor();
  assert.match(await panel.getByLabel('Research question').inputValue(),/robustness/);
  await panel.getByLabel('Fallback or alternative plan').fill('Browser-tested fallback.');
  await panel.getByRole('button',{name:'Add resource or approval requirement'}).click();
  await panel.getByLabel('Need',{exact:true}).fill('Synthetic compute allocation');
  await panel.getByLabel('Responsible username').fill('alice');
  await panel.getByLabel('Reason for this update').fill('Synthetic browser verification.');
  await panel.getByRole('checkbox').check();await panel.getByRole('button',{name:'Save research profile'}).click();
  await panel.getByRole('status').waitFor();
  await panel.getByRole('button',{name:'Tasks',exact:true}).click();
  await panel.getByText('Add a task',{exact:true}).click();
  const form=panel.locator('form').filter({has:page.getByRole('button',{name:'Create project task'})});
  await form.getByLabel('Task',{exact:true}).fill('Synthetic browser follow-up');await form.getByLabel('Due date').fill('2026-12-01');
  await form.getByRole('checkbox').check();await form.getByRole('button',{name:'Create project task'}).click();
  const row=panel.locator('article').filter({has:page.getByRole('heading',{name:'Synthetic browser follow-up',exact:true})});
  await row.getByText('Update task and completion evidence',{exact:true}).click();
  await row.getByLabel('Task status').selectOption('done');await row.getByLabel('Progress or completion evidence').fill('Verified using a synthetic browser example.');
  await row.getByLabel('I confirm this change and its recorded evidence.').check();await row.getByRole('button',{name:'Save task progress'}).click();
  await row.getByText(/Done · Due/).waitFor();
  const stored=await (await page.request.get(base+`/api/projects/${projectId}/workflow`)).json();
  assert.equal(stored.tasks.find((task:any)=>task.data.task==='Synthetic browser follow-up').data.status,'done');
  await panel.getByRole('button',{name:'Submissions',exact:true}).click();assert.equal(await panel.locator('article').count(),2);
  const currentPlan=panel.locator('article').first();
  await currentPlan.getByText('Submission result and reflection',{exact:true}).click();
  await currentPlan.getByRole('combobox',{name:/^Outcome/}).selectOption('submitted');
  await currentPlan.getByLabel('Actual submission time (UTC)').fill('2027-06-29T12:00');
  await currentPlan.getByLabel('Reason for this update').fill('Synthetic submission UI verification.');
  await currentPlan.getByLabel('I confirm this change and its recorded evidence.').check();
  await currentPlan.getByRole('button',{name:'Save submission outcome'}).click();
  await currentPlan.getByText('Outcome: Submitted',{exact:true}).waitFor();
  await currentPlan.getByText('Submission result and reflection',{exact:true}).click();
  assert.equal(await currentPlan.getByRole('combobox',{name:/^Outcome/}).inputValue(),'submitted','Saved outcome must also refresh the editor.');

  await panel.getByRole('button',{name:'Decisions',exact:true}).click();assert.equal(await panel.getByText('Record a checkpoint decision',{exact:true}).count(),0);
  await panel.getByText('Historical decision — research has changed.',{exact:false}).first().waitFor();
  await mkdir('/tmp/vioscope-project-workflow',{recursive:true});
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000});await panel.getByRole('button',{name:'Research',exact:true}).click();
   await panel.scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   await page.screenshot({path:`/tmp/vioscope-project-workflow/research-${width}.png`});
  }
  await context.addCookies([{name:cookieName,value:piToken,url:base}]);
  await page.reload();await page.getByLabel('Project details for Synthetic bound skeleton').click();
  await page.getByRole('button',{name:'Research workflow',exact:true}).click();
  await panel.getByRole('button',{name:'Decisions',exact:true}).click();
  await panel.getByText('Record a checkpoint decision',{exact:true}).click();
  const decisionForm=panel.locator('form');
  await decisionForm.getByRole('combobox',{name:/^Checkpoint/}).selectOption('submission_clearance');
  await decisionForm.getByRole('combobox',{name:/^Decision/}).selectOption('revise');
  await decisionForm.getByLabel('Reason and evidence assessment').fill('Synthetic PI requests updated evidence before submission.');
  await decisionForm.getByLabel('Checklist or rules version').fill('synthetic-ui-v1');
  await decisionForm.getByLabel('I confirm this change and its recorded evidence.').check();
  await decisionForm.getByRole('button',{name:'Record checkpoint decision'}).click();
  await panel.getByRole('heading',{name:'Submission clearance · Revise',exact:true}).waitFor();
  await page.setViewportSize({width:1440,height:1000});await panel.getByRole('heading',{name:'Submission clearance · Revise',exact:true}).scrollIntoViewIfNeeded();
  await page.screenshot({path:'/tmp/vioscope-project-workflow/pi-decision.png'});
  assert.deepEqual(errors,[]);console.log('Project workflow browser passed: research edits, shared tasks, submission history, decision permissions and responsive layout.');
 }finally{await browser?.close();await stopServer(server);}
}
