import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { chromium, getFreePort, startNextServer, waitForServer, stopServer, dismissWelcomeIfVisible } from './lib/playwright-smoke';
import { ideaDraftSchema } from '../src/mastra/projects/idea-check';

const root = process.cwd(), runtime = process.env.UI_RUNTIME;
const temp = runtime ? null : await mkdtemp(join(tmpdir(), 'vioscope-checklist-drafts-'));
let server: ReturnType<typeof startNextServer> | null = null;
let debugPage: any;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  if (temp) {
    const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {encoding:'utf8'}).trim().split('\n');
    for (const file of files) {
      const target = join(temp, file); await mkdir(dirname(target), { recursive: true }); await copyFile(join(root, file), target);
    }
    execFileSync('cp', ['-a', '--reflink=auto', resolve(root, 'node_modules') + '/', join(temp, 'node_modules')]);
  }
  process.chdir(runtime ? resolve(root, runtime) : temp!);
  const port = await getFreePort(), base = `http://127.0.0.1:${port}`;
  server = startNextServer({port, mode: runtime ? 'start' : 'dev'});
  await waitForServer(server, base, 480);
  browser = await chromium.launch();
  const page = await browser.newPage({viewport:{width:1440,height:1000}});
  debugPage = page;
  let account = 'draft_owner', savedVersion = 1, writes = 0;
  page.on('dialog', dialog => dialog.accept());
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const project = {id:'project-demo',title:'Draft test project',stage:4,ownerUsername:account,piUsername:'pi_demo',pdraUsername:'pdra_demo',collaborators:[],venue:'Demo',submissionDeadline:'2027-01-01',lifecycle:'active',access:{canEdit:true}};
  const pitch = {id:'pitch-demo',title:'Saved pitch',ownerUsername:account,projectId:null,outcome:null,access:'owner'};
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() !== 'GET') writes++;
    if (path === '/api/auth/me') return route.fulfill({json:{user:{id:account,username:account,displayName:account,role:'member',passwordResetRequired:false}}});
    if (path === '/api/skeleton-lock') return route.fulfill({json:{projects:[project],reviews:[],viewer:{username:account,manager:false,administrator:false}}});
    if (path === '/api/idea-pitches') return route.fulfill({json:{pitches:[pitch],scope:'personal'}});
    if (path === '/api/idea-pitches/pitch-demo') return route.fulfill({json:{pitch,current:{version:savedVersion,draft:ideaDraftSchema.parse({question:'Server version ' + savedVersion}),source:null,decision:null},history:[],reviews:[],collaborators:[],canEdit:true,canManage:true}});
    if (path === '/api/review-runs') return route.fulfill({json:{runs:[]}});
    return route.fulfill({status:503,json:{error:'Unrelated preview data unavailable'}});
  });
  const tab = (name:string) => page.getByRole('tab',{name,exact:true});
  async function refresh() {
    await page.reload();
    await page.locator('.console-topbar').waitFor();
    await dismissWelcomeIfVisible(page);
  }
  await page.goto(base + '/?view=checklists'); await page.locator('.console-topbar').waitFor(); await dismissWelcomeIfVisible(page);
  await tab('Skeleton Lock').click();
  await page.locator('.skeleton-lock .checklist-list-item[data-project-id="project-demo"]').click();
  await page.locator('#skeleton-input-claim').fill('Unsaved central claim');
  await refresh();
  assert.equal(await tab('Skeleton Lock').getAttribute('aria-selected'), 'true');
  assert.equal(await page.locator('#skeleton-input-claim').inputValue(),'Unsaved central claim');
  await page.getByText('Start from an existing document', { exact: true }).click();
  await page.getByLabel('Input method').selectOption('paste');
  await page.locator('.skeleton-lock textarea').fill('Unsaved outline');
  await refresh();
  assert.equal(await page.locator('.skeleton-lock textarea').inputValue(),'Unsaved outline');
  await tab('Idea Pitch').click();
  const pitchTitle = page.getByRole('textbox', { name: 'Pitch title', exact: true });
  assert.equal(await pitchTitle.getAttribute('required'), '');
  assert.equal(await page.getByText('Leave blank to use your research question.', {exact: false}).count(), 0);
  const { ideaFields } = await import('../src/mastra/projects/idea-check');
  assert.equal(await page.locator('.idea-fields textarea').count(), 5);
  for (const field of ideaFields) {
    const control = page.locator('.idea-fields textarea').nth(ideaFields.indexOf(field));
    assert.equal(await control.getAttribute('placeholder'), field.hint);
    assert.equal(await page.getByText(field.label, { exact: true }).count(), 1);
  }
  await mkdir(join(root, '.local/checks/idea-five-blocks'), { recursive: true });
  await page.locator('.idea-writing-sheet').screenshot({ path: join(root, '.local/checks/idea-five-blocks/desktop.png') });
  await page.setViewportSize({ width: 390, height: 900 });
  await page.locator('.idea-writing-sheet').screenshot({ path: join(root, '.local/checks/idea-five-blocks/mobile.png') });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('combobox',{name:/^Track/}).selectOption('B');
  await page.locator('.idea-fields textarea').first().fill('Unsaved new idea');
  await refresh();
  assert.equal(await page.locator('.idea-fields textarea').first().inputValue(),'Unsaved new idea');
  assert.equal(await page.getByRole('combobox',{name:/^Track/}).inputValue(),'B');
  await page.locator('.checklist-list-item[data-pitch-id="pitch-demo"]').click();
  // Switching away from unsaved changes asks for confirmation in the in-app dialog.
  await page.getByRole('button',{name:'Discard and switch',exact:true}).click();
  await page.locator('.idea-fields textarea').first().fill('Unsaved change to existing pitch');
  await refresh();
  assert.equal(await page.locator('.idea-pitches-panel .checklist-list-item[aria-current="true"]').getAttribute('data-pitch-id'),'pitch-demo');
  assert.equal(await page.locator('.idea-fields textarea').first().inputValue(),'Unsaved change to existing pitch');
  savedVersion = 2;
  await refresh();
  await page.getByText('A newer saved version or changed access was found.',{exact:false}).waitFor();
  assert.equal(await page.locator('.idea-fields textarea').first().inputValue(),'Pain point: Server version 2');
  await page.getByRole('button',{name:'Restore local draft',exact:true}).click();
  assert.equal(await page.locator('.idea-fields textarea').first().inputValue(),'Unsaved change to existing pitch');
  console.log('PASS: Skeleton project/blocks/paste and new/existing Idea drafts survive refresh; stale Idea version is not restored');

  assert.equal(await tab('PDRA Meta-Review').count(), 0);
  assert.equal(await tab('Red-Team').count(), 0);
  for (const removed of ['pdra', 'red']) {
    await page.evaluate(value => sessionStorage.setItem('vios-checklist:v1:draft_owner:tab', JSON.stringify(value)), removed);
    await refresh();
    assert.equal(await tab('Idea Pitch').getAttribute('aria-selected'), 'true');
    assert.equal(await page.locator('.idea-fields textarea').first().inputValue(), 'Unsaved change to existing pitch');
  }
  await tab('Skeleton Lock').click();
  await page.getByLabel('Input method').selectOption('blocks');
  assert.equal(await page.locator('#skeleton-input-claim').inputValue(),'Unsaved central claim');
  account = 'different_account'; await refresh();
  assert.equal(await tab('Idea Pitch').getAttribute('aria-selected'),'true');
  assert.equal(await page.locator('.idea-fields textarea').first().inputValue(),'');
  await tab('Skeleton Lock').click();
  await page.locator('.skeleton-lock .checklist-empty').waitFor();
  assert.equal(await page.locator('.skeleton-lock .checklist-list-item[aria-current="true"]').count(), 0);
  assert.equal(writes,0);
  assert.deepEqual(errors,[]);
  console.log('PASS: removed tabs fall back safely; account separation; zero automatic server writes');
} catch (error) {
  if (debugPage) console.log(await debugPage.evaluate(() => ({ text: document.body.innerText.slice(-2500), storage: {...sessionStorage} })));
  throw error;
} finally {
  await browser?.close(); await stopServer(server); process.chdir(root);
  if (temp) await rm(temp,{recursive:true,force:true});
}
