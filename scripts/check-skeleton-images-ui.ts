import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import { chromium, getFreePort, startNextServer, waitForServer, stopServer, dismissWelcomeIfVisible } from "./lib/playwright-smoke";
import { readSkeletonFigures } from "../src/mastra/submission/skeleton-figure-upload";
import { renderSkeletonDraft, skeletonDraftSchema } from "../src/mastra/submission/skeleton";
import { skeletonProjectSnapshot, type SkeletonRecord } from "../src/mastra/submission/skeleton-record";
import { uiCopyPrompts } from "../src/mastra/prompts";
const root=process.cwd(), runtime=process.env.UI_RUNTIME; if(runtime)process.chdir(resolve(runtime));
const output=resolve(root,".local/checks/skeleton-images-ui");await mkdir(output,{recursive:true});
const port=await getFreePort(),base=`http://127.0.0.1:${port}`,server=startNextServer({port,mode:"start"});let browser;
let debugPage: import('playwright').Page | undefined;
const project:any={id:"00000000-0000-4000-8000-000000000001",project:"synthetic-figures",title:"Synthetic figure review",ownerUsername:"owner",piUsername:"principal",pdraUsername:"reviewer",collaborators:[],stage:4,stageProgress:40,track:"A",lifecycle:"active",status:"on_track",artifacts:[],updates:[],todos:[],recommendation:"none",access:{canEdit:true,canAddUpdate:true}};
const second={...project,id:"00000000-0000-4000-8000-000000000002",title:"Other synthetic project"};
const png=await sharp({create:{width:800,height:480,channels:3,background:"#2080a0"}}).png().toBuffer();
const webp=await sharp(png).webp().toBuffer();
const file=(name="chart.png",mimeType="image/png",buffer=png)=>({name,mimeType,buffer});
let review:SkeletonRecord|null=null,failImage=true,posts=0;const errors:string[]=[];
try{
 await waitForServer(server,base,480);browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1440,height:1000}});debugPage=page;page.setDefaultTimeout(15000);page.on("pageerror",error=>errors.push(error.message));
 await page.route("**/api/**",async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path==="/api/auth/me")return route.fulfill({json:{user:{id:"owner",username:"owner",displayName:"Synthetic owner",role:"member",passwordResetRequired:false,aliases:[]}}});
  if(path==="/api/projects")return route.fulfill({json:{projects:[project,second]}});
  if(path==="/api/prompts/ui-copy")return route.fulfill({json:{prompts:uiCopyPrompts}});
  if(path==="/api/notifications")return route.fulfill({json:{notifications:[],unreadCount:0}});
  if(path==="/api/theme-meetings")return route.fulfill({json:{plan:null,notifications:[],users:[],access:{canManageThemeIds:[]},source:"unconfigured"}});
  if(path==="/api/chat/users"||path==="/api/users/directory")return route.fulfill({json:{users:[]}});
  if(path==="/api/idea-pitches")return route.fulfill({json:{pitches:[],scope:"personal"}});
  if(path==="/api/skeleton-lock"&&route.request().method()==="POST"){
   posts++;const form=await new Response(new Uint8Array(route.request().postDataBuffer()!),{headers:{"content-type":route.request().headers()["content-type"]}}).formData();
   if(form.get("mode")==="paste"){assert.equal(form.getAll("figures").length,0,"Hidden uploads must not be sent.");return route.fulfill({status:400,json:{error:"Synthetic pasted-document failure."}});}
   const figures=await readSkeletonFigures(form,"blocks");assert.equal(figures.length,2);assert.equal(figures[0].caption,"First caption: a synthetic heat map.");assert.equal(figures[1].caption,"Second caption: a synthetic comparison.");
   if(failImage){failImage=false;return route.fulfill({status:400,json:{error:"Synthetic image model failure. Please try again."}});}
   const draftText=`Project context (recorded in Projects):\n${JSON.stringify(skeletonProjectSnapshot(project))}\n\n${renderSkeletonDraft(skeletonDraftSchema.parse(JSON.parse(String(form.get("blocks")))),figures)}`;
   review={id:"00000000-0000-4000-8000-000000000003",projectId:project.id,projectSnapshot:skeletonProjectSnapshot(project),createdBy:"owner",createdAt:"2026-10-30T12:00:00Z",revision:0,draftText,decisions:[],result:{report:"Synthetic visual review",draftName:project.title,skills:[],draftTruncated:false,draftChars:draftText.length,finishReason:"stop",figureInputs:figures,structured:{verdict:"CONDITIONAL",summary:"Synthetic visual review with captions.",findings:figures.map(figure=>({area:figure.id,status:"partial",evidence:[figure.id],gap:"Synthetic image needs a legend.",requiredAction:"Add a legend."})),appliedSkills:[],reasonsToReject:[],checkmateQuestions:[],mitigations:[],humanSignOff:{leadPdra:"pending",piOrOrganizer:"pending",remainingEvidenceNeeded:[]},perSkillNotes:[]}}};return route.fulfill({json:{review}});
  }
  if(path==="/api/skeleton-lock")return route.fulfill({json:{projects:[project,second],reviews:review?[{id:review.id,projectId:project.id,projectSnapshot:review.projectSnapshot,createdAt:review.createdAt,revision:0,decisions:[],verdict:"CONDITIONAL",count:1}]:[],viewer:{username:"owner",manager:false,administrator:false}}});
  if(path.startsWith("/api/skeleton-lock/"))return route.fulfill({json:{review,choices:[{id:review!.id,createdAt:review!.createdAt,revision:0}]}});
  return route.fulfill({json:{}});
 });
 await page.goto(base+"/?view=checklists");await page.locator(".console-topbar").waitFor();await dismissWelcomeIfVisible(page);await page.getByRole("tab",{name:"Skeleton Lock",exact:true}).click();await page.locator(`.checklist-list-item[data-project-id="${project.id}"]`).click();
 const input=page.getByLabel("Figure images",{exact:true});const previews=page.locator(".skeleton-figure-uploads .skeleton-figure");const run=page.getByRole("button",{name:"Check skeleton with AI",exact:true});
 await input.setInputFiles(Array.from({length:5},(_,i)=>file(`chart-${i}.png`)));await page.getByText("Upload at most 4 figure images.",{exact:true}).waitFor();assert.equal(await previews.count(),0);
 await input.setInputFiles(file("large.png","image/png",Buffer.alloc(5*1024*1024+1)));await page.getByText("Choose PNG, JPEG or WebP images, each non-empty and at most 5 MB.",{exact:true}).waitFor();
 await input.setInputFiles([file(),file("map.webp","image/webp",webp)]);assert.equal(await previews.count(),2);await run.click();assert.equal(posts,0,"Missing captions prevent submission.");
 await page.getByLabel("Caption for figure 2",{exact:true}).fill("First caption: a synthetic heat map.");await page.getByLabel("Remove figure 1",{exact:true}).click();assert.equal(await page.getByLabel("Caption for figure 1",{exact:true}).inputValue(),"First caption: a synthetic heat map.");
 await input.setInputFiles(file());await page.getByLabel("Caption for figure 2",{exact:true}).fill("Second caption: a synthetic comparison.");
 for(const width of [1440,768,390]){await page.setViewportSize({width,height:1000});await previews.first().scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({animations:"disabled",path:`${output}/draft-${width}.png`});}
 await page.setViewportSize({width:1440,height:1000});await page.getByText("Start from an existing document",{exact:true}).click();await page.getByLabel("Input method").selectOption("paste");await page.getByRole("textbox",{name:/^Paste outline/}).fill("Synthetic text-only outline.");await run.click();await page.getByText("Synthetic pasted-document failure.",{exact:true}).waitFor();
 await page.getByLabel("Input method").selectOption("blocks");assert.equal(await previews.count(),2);
 await run.click();await page.getByText("Synthetic image model failure. Please try again.",{exact:true}).waitFor();assert.equal(await previews.count(),2);assert.equal(await page.getByLabel("Caption for figure 1",{exact:true}).inputValue(),"First caption: a synthetic heat map.");
 await run.click();const saved=page.getByLabel("Reviewed figure images",{exact:true});await saved.waitFor();assert.equal(await saved.locator("img").count(),2);assert.equal(await input.count(),0);assert.equal(posts,3);
 await page.reload();await page.locator(".console-topbar").waitFor();await dismissWelcomeIfVisible(page);await saved.waitFor();assert.equal(await saved.locator("img").count(),2);
 await page.waitForFunction(()=>Array.from(document.querySelectorAll<HTMLImageElement>("[aria-label='Reviewed figure images'] img")).every(image=>image.complete&&image.naturalWidth>0));
 for(const width of [1440,768,390]){await page.setViewportSize({width,height:1000});await saved.scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({animations:"disabled",path:`${output}/saved-${width}.png`});}
 assert.deepEqual(errors,[]);console.log("Skeleton image UI passed: limits, previews, required captions, removal, hidden-mode exclusion, failed request recovery, saved images after reload, desktop/tablet/mobile.");
}catch(error){console.log(errors);if(debugPage&&!debugPage.isClosed()){console.log(await debugPage.locator('.skeleton-lock').innerText());await debugPage.screenshot({path:output+'/failure.png'});}throw error;
}finally{await browser?.close();await stopServer(server);process.chdir(root);}
