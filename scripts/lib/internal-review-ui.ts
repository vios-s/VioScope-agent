import {fakeRedTeam,syntheticPaperPdf} from './red-team-fixture';
import assert from 'node:assert/strict';
import type { Browser } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getUserByUsername, type AuthUser } from '../../src/mastra/db/users';
import { createSessionToken,sessionCookieName } from '../../src/mastra/auth/session';
import { createProject } from '../../src/mastra/db/projects';
import { changeProjectWorkflow } from '../../src/mastra/db/project-workflow';
import { runSubmissionReminders } from '../../src/mastra/submission/reminders';
import {runInternalRedTeam} from '../../src/mastra/db/internal-red-team';
import { getInternalReviews } from '../../src/mastra/db/internal-reviews';
import { chromium,getFreePort,startNextServer,waitForServer,stopServer } from './playwright-smoke';

export async function checkInternalReviewUi(owner:AuthUser,pdra:AuthUser,pi:AuthUser,collaborator:AuthUser) {
  const project=await createProject({title:'Synthetic browser review',pdraUsername:pdra.username,piUsername:pi.username,collaborators:[collaborator.username]},owner);
  await changeProjectWorkflow(project.id,{operation:'submission',confirmed:true,currentId:null,plan:{venue:'Synthetic venue',cycle:'UI cycle',deadline:new Date(Date.now()+40*86400000).toISOString(),timezone:'Europe/London'},reason:'Browser test'},owner);
  await changeProjectWorkflow(project.id,{operation:'evidence',confirmed:true,title:'Versioned synthetic manuscript',claim:'Synthetic paper',kind:'document',state:'completed',summary:'Manuscript and completion evidence',artifactId:null,url:'https://example.org/manuscript/v1'},owner);
  const evidenceId=(await getInternalReviews(project.id,owner)).evidence[0].id;
  const root=process.cwd(),runtime=process.env.UI_RUNTIME;if(runtime)process.chdir(resolve(runtime));
  const output=resolve(root,'.local/checks/internal-review');await mkdir(output,{recursive:true});
  const port=await getFreePort(),base=`http://127.0.0.1:${port}`,server=startNextServer({port,mode:'start',env:{...process.env,EMAIL_NOTIFICATIONS_ENABLED:'false'}});let browser:Browser|undefined;
  const errors:string[]=[];
  try {
    await waitForServer(server,base,480);browser=await chromium.launch();
    async function pageFor(user:AuthUser) {
      const context=await browser!.newContext({viewport:{width:1440,height:1000}});
      await context.addCookies([{name:sessionCookieName,value:createSessionToken(user),url:base}]);
      const page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
      await page.addLocatorHandler(page.locator('.welcome-dialog'),async()=>{await page.getByLabel('Close welcome message').click();});
      await page.route('**/api/theme-meetings',r=>r.fulfill({json:{plan:null,notifications:[],users:[],access:{canManageThemeIds:[]},source:'unconfigured'}}));
      await page.goto(base+'/?view=checklists');await page.getByRole('tab',{name:'Internal Review',exact:true}).click();try {await page.locator(`.internal-review .checklist-list-item[data-project-id="${project.id}"]`).click();} catch(error) {console.log({errors,body:(await page.locator('body').innerText()).slice(0,7000)});await page.screenshot({path:output+'/failure.png'});throw error;}
      await page.getByText(`Owner: @${owner.username}`,{exact:true}).waitFor();return page;
    }
    const setup=await pageFor(owner);
    await setup.goto(base+'/?view=projects');
    await setup.getByLabel('Project overview for Synthetic browser review',{exact:true}).click();
    await setup.getByRole('button',{name:'Edit details',exact:true}).click();
    const teamForm=setup.getByRole('dialog',{name:'Edit details',exact:true});
    await teamForm.getByLabel('Project PIs',{exact:true}).fill([pi.username,'secondpi'].join(', '));
    await teamForm.getByLabel('Project PDRAs',{exact:true}).fill([pdra.username,'otherpdra'].join(', '));
    await teamForm.getByLabel('Lead PDRA reviewer',{exact:true}).selectOption(pdra.username);
    for(const width of [1440,390]){await setup.setViewportSize({width,height:1000});await teamForm.getByLabel('Project PIs',{exact:true}).scrollIntoViewIfNeeded();await setup.screenshot({path:`${output}/review-team-${width}.png`,animations:'disabled'});assert.equal(await setup.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
    await teamForm.getByRole('button',{name:'Save changes',exact:true}).click();
    await teamForm.waitFor({state:'hidden'});
    const assigned=(await getInternalReviews(project.id,owner)).project;
    assert.deepEqual([...assigned.piUsernames].sort(),[pi.username,'secondpi'].sort());
    assert.deepEqual([...assigned.pdraUsernames].sort(),[pdra.username,'otherpdra'].sort());
    await setup.close();
    const author=await pageFor(owner);
    // Exercise the shared checklist layout and mobile project picker before submitting.
    for(const width of [1440,768,390]) {
      await author.setViewportSize({width,height:1000});
      if(width<1280) {
        await author.locator('.internal-review .checklist-list-toggle').click();
        await author.getByLabel('Find a project',{exact:true}).fill('no-such-project-123');
        await author.getByText('No projects match this search.',{exact:true}).waitFor();
        await author.getByLabel('Find a project',{exact:true}).fill('Synthetic browser review');
        await author.locator(`.internal-review .checklist-list-item[data-project-id="${project.id}"]`).click();
        assert.equal(await author.locator('.internal-review .checklist-list-toggle').getAttribute('aria-expanded'),'false');
      }
      await author.locator('.checklist-record-title').scrollIntoViewIfNeeded();
      assert.equal(await author.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      for(const number of await author.locator('.ir-stages .checklist-block-num').all())assert.equal(await number.evaluate(el=>el.getBoundingClientRect().height<=parseFloat(getComputedStyle(el).lineHeight)+1),true,'Workflow numbers stay on one line.');
      await author.screenshot({path:`${output}/workspace-${width}.png`,animations:'disabled'});
    }
    await author.setViewportSize({width:1440,height:1000});
    const upload=author.locator('.ir-pdf-upload');
    await upload.getByLabel('Manuscript version label').fill('Browser manuscript v1');
    await upload.getByLabel('Manuscript PDF',{exact:true}).setInputFiles({name:'browser-paper.pdf',mimeType:'application/pdf',buffer:syntheticPaperPdf()});
    await upload.getByRole('checkbox').check();await upload.getByRole('button',{name:'Upload PDF and start review',exact:true}).click();
    await author.getByText(/AI review could not be completed/).waitFor();
    assert.equal(await author.getByRole('tab',{name:'AI Internal Red-Team',exact:true}).getAttribute('aria-selected'),'true');
    const aiRound=(await getInternalReviews(project.id,owner)).rounds[0];
    const pdfEvidence=(await getInternalReviews(project.id,owner)).evidence.find(e=>e.id===aiRound.data.manuscript.evidenceId)!;
    assert.ok(pdfEvidence.data.artifactId);assert.equal((await author.request.get(`${base}/api/project-artifacts/${pdfEvidence.data.artifactId}/download`)).status(),200);
    await runInternalRedTeam(project.id,aiRound.id,owner,fakeRedTeam);
    const aiViewer=await pageFor(pi);
    assert.equal(await aiViewer.locator('.ir-ai').isVisible(),false);
    assert.equal(await aiViewer.locator('.ir-pdf-upload').count(),0);
    const denied=await aiViewer.request.post(`${base}/api/projects/${project.id}/internal-review/manuscript`,{multipart:{label:'Forbidden PI upload',submissionId:(await getInternalReviews(project.id,owner)).submission.id,previousRoundId:aiRound.id,confirmed:'true',pdf:{name:'paper.pdf',mimeType:'application/pdf',buffer:syntheticPaperPdf()}}});assert.equal(denied.status(),403);
    await aiViewer.getByRole('tab',{name:'AI Internal Red-Team',exact:true}).click();
    await aiViewer.getByRole('heading',{name:'Summary & Contribution',exact:true}).waitFor();
    assert.equal(await aiViewer.locator('.ir-ai blockquote').count(),9);
    assert.equal(await aiViewer.locator('.ir-ai .checklist-block-head').count(),6);
    await aiViewer.getByText('Input data and review scope',{exact:true}).click();
    for(const width of [1440,768,390]){await aiViewer.setViewportSize({width,height:1000});await aiViewer.locator('.ir-ai').scrollIntoViewIfNeeded();assert.equal(await aiViewer.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await aiViewer.screenshot({path:`${output}/red-team-${width}.png`,animations:'disabled'});}
    await aiViewer.getByRole('tab',{name:'AI Internal Red-Team',exact:true}).focus();await aiViewer.keyboard.press('Home');assert.equal(await aiViewer.getByRole('tab',{name:'Reviews',exact:true}).getAttribute('aria-selected'),'true');
    const reviewer=await pageFor(pdra);
    await reviewer.getByText('Write your Meta-Review',{exact:true}).click();
    const editor=reviewer.locator('form').filter({has:reviewer.getByRole('button',{name:'Submit review',exact:true})});
    await editor.getByLabel('Summary and contribution',{exact:true}).fill('Synthetic private reviewer summary.');
    await reviewer.getByRole('tab',{name:'AI Internal Red-Team',exact:true}).click();await reviewer.getByRole('tab',{name:'Reviews',exact:true}).click();assert.equal(await editor.getByLabel('Summary and contribution',{exact:true}).inputValue(),'Synthetic private reviewer summary.','Switching to AI must preserve the human draft.');
    await editor.getByLabel('Primary strengths').fill('Clear motivation and well-defined evaluation.');await editor.getByLabel('Primary weaknesses').fill('The module contribution needs an ablation.');
    for(const box of await editor.locator('.ir-check').all()){await box.getByLabel('Assessment',{exact:true}).selectOption('yes');await box.getByLabel('Draft evidence or reason').fill('Section 3 and Table 2 support this assessment.');}
    await editor.getByRole('button',{name:'Add revision item',exact:true}).click();await editor.getByLabel('Required change',{exact:true}).fill('Add the missing module ablation.');await editor.getByLabel('Evidence in the draft',{exact:true}).fill('Table 2 lacks a module-only comparison.');
    const beforeConcurrent=(await getInternalReviews(project.id,owner)).rounds[0];
    const concurrent=await author.request.post(base+`/api/projects/${project.id}/internal-review`,{data:{operation:'invite',confirmed:true,roundId:beforeConcurrent.id,revision:beforeConcurrent.revision,username:collaborator.username}});assert.equal(concurrent.ok(),true);
    await editor.getByRole('button',{name:'Save private draft',exact:true}).click();await editor.getByText(/The round changed/).waitFor();
    assert.equal(await editor.getByLabel('Summary and contribution',{exact:true}).inputValue(),'Synthetic private reviewer summary.','Conflict refresh must preserve the local draft.');
    await editor.getByRole('button',{name:'Save private draft',exact:true}).click();await editor.getByText('Private draft saved.',{exact:true}).waitFor();
    const privatePayload=await (await author.request.get(base+`/api/projects/${project.id}/internal-review`)).json();assert.equal(Object.keys(privatePayload.rounds[0].data.reviews).length,0);
    for(const width of [1440,768,390]){await reviewer.setViewportSize({width,height:1000});assert.equal(await reviewer.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await editor.scrollIntoViewIfNeeded();await reviewer.screenshot({path:`${output}/review-${width}.png`,animations:'disabled'});}
    await reviewer.setViewportSize({width:1440,height:1000});await editor.getByRole('checkbox').check();await editor.getByRole('button',{name:'Submit review',exact:true}).click();await reviewer.getByRole('heading',{name:`@${pdra.username} · Required PDRA review`,exact:true}).waitFor();
    await reviewer.getByRole('tab',{name:'Revision Tracker',exact:true}).click();await reviewer.getByText('Classify or revise requirement',{exact:true}).click();
    const triage=reviewer.locator('form').filter({has:reviewer.getByRole('button',{name:'Save revision requirement',exact:true})});await triage.getByLabel('Reason and resolution of conflicting advice').fill('The ablation is required to support the claim.');await triage.getByRole('button',{name:'Save revision requirement',exact:true}).click();await reviewer.getByText('PDRA verification',{exact:true}).waitFor();
    const author2=await pageFor(owner);await author2.getByRole('tab',{name:'Revision Tracker',exact:true}).click();await author2.getByText('Update progress and evidence',{exact:true}).click();
    const progress=author2.locator('form').filter({has:author2.getByRole('button',{name:'Save revision progress',exact:true})});await progress.getByLabel('Status',{exact:true}).selectOption('done');await progress.getByLabel('Completion evidence or progress').fill('Table 3 now includes the ablation.');await progress.getByRole('checkbox',{name:'Versioned synthetic manuscript',exact:true}).check();await progress.getByRole('button',{name:'Save revision progress',exact:true}).click();
    await author2.getByText(/Required · done/).waitFor();assert.equal(await author2.getByRole('button',{name:'Record PDRA verification',exact:true}).count(),0);
    const reviewer2=await pageFor(pdra);await reviewer2.getByRole('tab',{name:'Revision Tracker',exact:true}).click();await reviewer2.getByText('PDRA verification',{exact:true}).click();
    const verify=reviewer2.locator('form').filter({has:reviewer2.getByRole('button',{name:'Record PDRA verification',exact:true})});await verify.getByLabel('Verification evidence and reason').fill('Verified the ablation in Table 3.');await verify.getByRole('checkbox').check();await verify.getByRole('button',{name:'Record PDRA verification',exact:true}).click();
    const lock=reviewer2.locator('form').filter({has:reviewer2.getByRole('button',{name:'Pass Revision Lock',exact:true})});await lock.getByLabel('Manuscript version label').fill('Final manuscript v2');await lock.getByLabel('Manuscript evidence').selectOption(evidenceId);await lock.getByLabel('Verification and remaining limitations').fill('All required changes verified; limitations documented.');await lock.getByRole('checkbox').check();await lock.getByRole('button',{name:'Pass Revision Lock',exact:true}).click();await reviewer2.getByText('Passed — current reviews and tasks verified.',{exact:true}).waitFor();
    assert.equal(await reviewer2.getByRole('button',{name:'Record final PI clearance',exact:true}).count(),0);
    const principal=await pageFor((await getUserByUsername('secondpi'))!);await principal.getByRole('tab',{name:'Revision Tracker',exact:true}).click();
    assert.equal(await principal.getByText('Add manuscript or revision evidence',{exact:true}).count(),0);
    assert.equal(await principal.getByText('Submit a new manuscript round',{exact:true}).count(),0);
    assert.equal(await principal.getByLabel('Review round',{exact:true}).count(),1);
    const clearance=principal.locator('.ir-clearance');await clearance.getByRole('button',{name:'Record final PI clearance',exact:true}).waitFor();
    for(const width of [1440,768,390]){await principal.setViewportSize({width,height:1000});await clearance.scrollIntoViewIfNeeded();assert.equal(await principal.locator('.ir-rail').evaluate(el=>getComputedStyle(el).overflowY==='visible'&&getComputedStyle(el).maxHeight==='none'),true);assert.equal(await principal.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await principal.screenshot({path:`${output}/clearance-${width}.png`,animations:'disabled'});}
    await clearance.getByLabel('Reason and evidence assessment').fill('The verified revisions are ready for submission.');await clearance.getByRole('checkbox').check();await clearance.getByRole('button',{name:'Record final PI clearance',exact:true}).click();await clearance.getByText('Approved for submission.',{exact:true}).waitFor();
    assert.equal((await getInternalReviews(project.id,owner)).rounds[0].clearanceValid,true);
    const optional=await pageFor(collaborator);await optional.getByText('Write your Meta-Review',{exact:true}).click();assert.equal(await optional.getByRole('button',{name:'Submit review',exact:true}).isVisible(),true);
    const secondReviewer=await pageFor((await getUserByUsername('otherpdra'))!);await secondReviewer.getByText('Write your Meta-Review',{exact:true}).click();assert.equal(await secondReviewer.getByRole('button',{name:'Submit review',exact:true}).isVisible(),true);await secondReviewer.getByRole('tab',{name:'Revision Tracker',exact:true}).click();assert.equal(await secondReviewer.getByRole('button',{name:'Pass Revision Lock',exact:true}).count(),0);
    await runSubmissionReminders();
    const notified=await pageFor(owner);
    for(let attempt=0;attempt<2;attempt++){
      await notified.getByRole('tab',{name:'Skeleton Lock',exact:true}).click();
      await notified.getByRole('button',{name:/^Open Notifications centre/}).click();
      // Read history is shown once no unread messages remain; other synthetic projects also send reminders.
      const markAll=notified.getByRole('button',{name:'Mark all as read',exact:true});
      if(attempt>0&&await markAll.count())await markAll.click();
      await notified.locator('.notification-row').filter({hasText:'Synthetic browser review: T−6 weeks'}).click();
      await notified.locator(`.internal-review .checklist-record-host[data-project-id="${project.id}"]`).waitFor();
      assert.equal(await notified.locator('.internal-review .checklist-list-item[aria-current="true"]').getAttribute('data-project-id'),project.id);
    }
    await notified.goto(base+'/?view=projects');
    await notified.getByLabel('Project details for Synthetic browser review',{exact:true}).click();
    await notified.getByRole('tablist',{name:'Project record sections'}).getByRole('tab',{name:'Details',exact:true}).click();
    await notified.getByRole('tablist',{name:'Workflow records'}).getByRole('tab',{name:'Checkpoints',exact:true}).click();
    const workflow=notified.locator('.project-workflow');
    await workflow.getByRole('heading',{name:'Checkpoint decisions',exact:true}).waitFor();
    assert.equal(await workflow.getByText('Open Internal Review and Revision Tracker',{exact:true}).count(),0);
    assert.equal(await workflow.locator('.internal-review').count(),0,'Internal Review belongs only in Checklists.');
    for(const width of [1440,390]) {
      await notified.setViewportSize({width,height:1000});
      await workflow.getByRole('heading',{name:'Checkpoint decisions',exact:true}).scrollIntoViewIfNeeded();
      assert.equal(await notified.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      await notified.screenshot({path:`${output}/project-checkpoints-${width}.png`,animations:'disabled'});
    }
    // PI can still record checkpoints; the retained decision history follows the form.
    await principal.setViewportSize({width:1440,height:1000});
    await principal.goto(base+'/?view=projects');
    await principal.getByLabel('Project details for Synthetic browser review',{exact:true}).click();
    await principal.getByRole('tablist',{name:'Project record sections'}).getByRole('tab',{name:'Details',exact:true}).click();
    await principal.getByRole('tablist',{name:'Workflow records'}).getByRole('tab',{name:'Checkpoints',exact:true}).click();
    const checkpointForm=principal.locator('.project-workflow details').filter({has:principal.locator('summary').filter({hasText:/^Record a checkpoint decision$/})});
    await checkpointForm.locator('summary').click();
    await checkpointForm.locator('select[name=checkpoint]').waitFor();
    const history=principal.locator('.project-workflow').getByRole('heading',{name:'Checkpoint decisions',exact:true});
    for(const width of [1440,390]) {
      await principal.setViewportSize({width,height:1000});
      const formBox=await checkpointForm.boundingBox(),historyBox=await history.boundingBox();
      assert.ok(formBox&&historyBox&&historyBox.y>=formBox.y+formBox.height,'Recorded checkpoints must follow the decision form.');
      await checkpointForm.locator('summary').scrollIntoViewIfNeeded();
      await principal.screenshot({path:`${output}/project-checkpoint-form-${width}.png`,animations:'disabled'});
      assert.equal(await principal.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    }
    assert.deepEqual(errors,[]);console.log('Internal review browser passed: owner submission/read-only reviews, private drafts, PDRA review, canonical tasks, verification, Revision Lock, PI footer clearance and responsive layouts.');
  } finally {await browser?.close();await stopServer(server);process.chdir(root);}
}
