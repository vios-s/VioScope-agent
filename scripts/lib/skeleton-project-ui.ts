import assert from 'node:assert/strict';
import type { Route } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium,getFreePort,startNextServer,waitForServer,stopServer } from './playwright-smoke';
export async function checkSkeletonProjectUi(cookieName:string,tokens:{owner:string;pdra:string;pi:string},projectId:string,reviewId:string){
  const port=await getFreePort();const base=`http://127.0.0.1:${port}`;const server=startNextServer({port,mode:'start',env:{...process.env,EMAIL_NOTIFICATIONS_ENABLED:'false'}});let browser;
  try{
    await waitForServer(server,base);browser=await chromium.launch();
    const errors:string[]=[];
    async function pageFor(token:string){
      const context=await browser!.newContext({viewport:{width:1440,height:1000}});await context.addCookies([{name:cookieName,value:token,url:base}]);
      const page=await context.newPage();page.on('pageerror',(error: Error)=>errors.push(error.message));await page.addLocatorHandler(page.locator('.welcome-dialog'),async()=>{await page.getByLabel('Close welcome message').click();});
      await page.goto(base+'/?view=checklists');await page.getByRole('tab',{name:'Skeleton Lock',exact:true}).click();await page.getByRole('button',{name:/^Existing project/}).waitFor();return page;
    }
    const owner=await pageFor(tokens.owner);await owner.route('**/api/skeleton-lock',async (route: Route) => { const response=await route.fetch(); const body=await response.json(); const original=body.projects.find((item:{id:string})=>item.id===projectId); body.projects.push(...Array.from({length:100},(_,i)=>({...original,id:`synthetic-list-${i}`,title:`Synthetic list project ${i}`}))); await route.fulfill({response,json:body}); });
    await owner.reload();await owner.getByRole('tab',{name:'Skeleton Lock',exact:true}).click();
    const picker=owner.getByRole('button',{name:/^Existing project/});await picker.click();
    await owner.getByRole('status').filter({hasText:'101 projects found.'}).waitFor();
    assert.equal(await picker.getAttribute('aria-expanded'),'true');
    await mkdir('/tmp/vioscope-skeleton-taste',{recursive:true});
    for (const width of [1440,768,390]) { await owner.setViewportSize({width,height:1000}); await picker.scrollIntoViewIfNeeded(); await owner.screenshot({path:`/tmp/vioscope-skeleton-taste/picker-${width}.png`}); assert.equal(await owner.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true); }
    const specimen=await owner.evaluate(()=>{const css=Array.from(document.styleSheets).map(sheet=>{try{return Array.from(sheet.cssRules).map(rule=>rule.cssText).join('\n');}catch{return '';}}).join('\n');return `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css} body{padding:24px;margin:0;background:var(--surface-2)}h1{font-size:24px;margin:0 0 24px}</style></head><body><h1>Project selection</h1><section class="skeleton-lock">${document.querySelector('.skeleton-project-picker')!.outerHTML}</section></body></html>`;});
    await writeFile('/tmp/vioscope-skeleton-taste/component.html',specimen);
    await owner.setViewportSize({width:1440,height:1000});

    const search=owner.getByRole('searchbox',{name:'Search projects',exact:true});await search.fill('no matching project');await owner.getByText('No matching projects.',{exact:true}).waitFor();
    await search.fill('Synthetic bound skeleton');await search.press('Enter');assert.equal(await picker.getAttribute('aria-expanded'),'true');
    await owner.locator('.skeleton-project-options button').filter({hasText:'Synthetic bound skeleton'}).click();assert.equal(await picker.getAttribute('aria-expanded'),'false');
    await picker.click();await owner.getByRole('searchbox').press('Escape');assert.equal(await picker.getAttribute('aria-expanded'),'false');
    assert.equal(await owner.getByRole('textbox',{name:'Initiator',exact:true}).count(),0);
    assert.equal(await owner.getByRole('textbox',{name:'Deadline',exact:true}).count(),0);
    await owner.getByText('Fictional venue',{exact:true}).waitFor();await owner.getByText('2026-12-15',{exact:true}).waitFor();
    assert.equal(await owner.getByRole('button',{name:'PDRA review',exact:true}).count(),0);
    const pdra=await pageFor(tokens.pdra);await pdra.getByRole('button',{name:'PDRA review',exact:true}).click();
    await pdra.locator('.skeleton-review-list button').first().click();
    const form=pdra.getByRole('group',{name:'PDRA judgment',exact:true});await form.waitFor();
    await form.getByRole('combobox',{name:'Judgment',exact:true}).selectOption('conditional');
    await form.getByRole('textbox',{name:'Reason, evidence and required actions',exact:true}).fill('Synthetic PDRA: record the missing baseline result before locking.');
    await form.getByRole('checkbox').check();await form.getByRole('button',{name:'Record PDRA judgment',exact:true}).click();
    await pdra.getByRole('status').filter({hasText:'PDRA judgment recorded.'}).waitFor();
    assert.equal(await pdra.getByRole('button',{name:'Record PI confirmation',exact:true}).count(),0);
    const pi=await pageFor(tokens.pi);await pi.getByRole('button',{name:'PI / Admin overview',exact:true}).click();await pi.locator('.skeleton-review-list button').first().click();
    const final=pi.getByRole('group',{name:'Final PI confirmation',exact:true});await final.waitFor();
    await final.getByRole('combobox',{name:'Judgment',exact:true}).selectOption('needs_revision');
    await final.getByRole('textbox',{name:'Reason, evidence and required actions',exact:true}).fill('Synthetic PI: baseline evidence is still required.');await final.getByRole('checkbox').check();
    await final.getByRole('button',{name:'Record PI confirmation',exact:true}).click();await pi.getByRole('status').filter({hasText:'PI confirmation recorded.'}).waitFor();
    const stored=await (await pi.request.get(base+'/api/skeleton-lock/'+reviewId)).json();assert.equal(stored.review.decisions.length,2);assert.deepEqual(stored.review.decisions.map((item:{by:string})=>item.by),['bob','principal']);
    await mkdir('/tmp/vioscope-skeleton-project',{recursive:true});
    await owner.getByRole('heading',{name:'Skeleton Lock',exact:true}).scrollIntoViewIfNeeded();await owner.screenshot({path:'/tmp/vioscope-skeleton-project/project-context.png'});
    await pdra.getByRole('heading',{name:'Synthetic bound skeleton — saved review',exact:true}).scrollIntoViewIfNeeded();await pdra.screenshot({path:'/tmp/vioscope-skeleton-project/pdra.png'});
    await pi.setViewportSize({width:390,height:844});assert.equal(await pi.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await final.scrollIntoViewIfNeeded();await pi.screenshot({path:'/tmp/vioscope-skeleton-project/pi-mobile.png'});
    assert.deepEqual(errors,[]);console.log('Skeleton project browser passed: inherited read-only context, dedicated PDRA view, separate PI judgment and mobile layout.');
  }finally{await browser?.close();await stopServer(server);}
}
