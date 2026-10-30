import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import sharp from "sharp";
import { readSkeletonFigures, readSkeletonForm } from "../src/mastra/submission/skeleton-figure-upload";
import { renderSkeletonDraft, skeletonDraftSchema } from "../src/mastra/submission/skeleton";
import { createPostgresClient, closePostgresPools } from "../src/mastra/db/postgres";

const svg = `<svg width="640" height="400" xmlns="http://www.w3.org/2000/svg"><rect width="640" height="400" fill="white"/><path d="M60 65 V340 H600" fill="none" stroke="black"/><rect x="90" y="187" width="80" height="153" fill="#2764c5"/><rect x="270" y="79" width="80" height="261" fill="#c52835"/><rect x="450" y="241" width="80" height="99" fill="#298244"/><g font-family="sans-serif" font-size="24" fill="black"><text x="40" y="32">SYNTHETIC comparison — score</text><text x="100" y="177">17</text><text x="280" y="69">29</text><text x="460" y="231">11</text><text x="85" y="375">Blue</text><text x="265" y="375">Red</text><text x="445" y="375">Green</text><text x="20" y="348">0</text></g></svg>`;
const png = await sharp(Buffer.from(svg)).png().toBuffer();
const caption = "Synthetic comparison: the blue bar has the highest score.";
const upload = (bytes = png, type = "image/png", name = "synthetic.png") => new File([new Uint8Array(bytes)], name, { type });
const formFor = (file = upload(), text = caption) => { const form = new FormData(); form.append("figures", file); form.append("figureCaptions", text); return form; };
const figures = await readSkeletonFigures(formFor(), "blocks");
assert.equal(figures[0].id, "figure:1"); assert.equal(figures[0].width, 640); assert.equal(figures[0].height, 400);
assert.equal(figures[0].sha256.length, 64);
assert.equal((await sharp(Buffer.from(figures[0].dataUrl.split(",")[1], "base64")).metadata()).exif, undefined);
assert.match(renderSkeletonDraft(skeletonDraftSchema.parse({}), figures), /figure:1/);
assert.ok(renderSkeletonDraft(skeletonDraftSchema.parse({figures:"x".repeat(6000)}),[{...figures[0],caption:"y".repeat(2000)}]).includes("y".repeat(2000)), "Captions do not silently truncate section text.");
for (const format of ["jpeg", "webp"] as const) {
 const file = upload(await sharp(png).toFormat(format).toBuffer(), `image/${format}`, `test.${format}`);
 assert.match((await readSkeletonFigures(formFor(file), "blocks"))[0].dataUrl, /^data:image\/png;base64,/);
}
await assert.rejects(readSkeletonFigures(formFor(), "paste"), /only in/);
await assert.rejects(readSkeletonFigures(formFor(upload(), " "), "blocks"), /caption/);
await assert.rejects(readSkeletonFigures(formFor(upload(), "a".repeat(2001)), "blocks"), /2,000/);
await assert.rejects(readSkeletonFigures(formFor(upload(Buffer.from("not an image"))), "blocks"), /valid/);
await assert.rejects(readSkeletonFigures(formFor(upload(Buffer.from(svg))), "blocks"), /valid/);
await assert.rejects(readSkeletonFigures(formFor(upload(png, "image/jpeg")), "blocks"), /valid/);
await assert.rejects(readSkeletonFigures(formFor(upload(png, "image/svg+xml")), "blocks"), /PNG/);
const animated = await sharp(Buffer.concat([Buffer.alloc(12,0),Buffer.alloc(12,255)]),{raw:{width:2,height:4,channels:3,pageHeight:2}}).webp({loop:0,delay:[100,100]}).toBuffer();
assert.equal((await sharp(animated).metadata()).pages,2);
await assert.rejects(readSkeletonFigures(formFor(upload(animated,"image/webp","animation.webp")),"blocks"),/non-animated/);
await assert.rejects(readSkeletonFigures(formFor(upload(Buffer.alloc(5 * 1024 * 1024 + 1))), "blocks"), /5 MB/);
const huge = await sharp({create:{width:4097,height:4097,channels:3,background:"white"}}).png().toBuffer();
await assert.rejects(readSkeletonFigures(formFor(upload(huge)), "blocks"), /16 megapixels/);
const many = new FormData();for(let i=0;i<5;i++){many.append("figures",upload());many.append("figureCaptions",caption);}
await assert.rejects(readSkeletonFigures(many, "blocks"), /at most 4/);
const mismatch = formFor();mismatch.delete("figureCaptions");await assert.rejects(readSkeletonFigures(mismatch,"blocks"),/one caption/);
const requestForm = new Request("http://localhost",{method:"POST",body:formFor()});assert.equal((await readSkeletonForm(requestForm)).getAll("figures").length,1);
await assert.rejects(readSkeletonForm(new Request("http://localhost",{method:"POST",headers:{"content-length":String(29*1024*1024)},body:"x"})),/28 MB/);
const stream = new ReadableStream({start(controller){controller.enqueue(new Uint8Array(29*1024*1024));controller.close();}});
await assert.rejects(readSkeletonForm(new Request("http://localhost",{method:"POST",body:stream,duplex:"half"} as RequestInit)),/28 MB/);

if (process.argv.includes("--live")) {
 const { reviewSubmission } = await import("../src/mastra/submission/review");
 const draftText = renderSkeletonDraft(skeletonDraftSchema.parse({figures:"This is a fictional chart, not a research result. Check whether its caption agrees with the visible bars. All other sections are not provided."}), figures);
 const result = await reviewSubmission({draftText,draftName:"SYNTHETIC image/caption mismatch",skills:["vios-skeleton-lock"],figures,extraInstructions:"Focus a finding on the attached chart and whether its caption is accurate. Report the visible value labels of the bars in that finding. Do not claim scientific validity from this synthetic image."});
 const finding = result.structured.findings.filter(item=>item.evidence.includes("figure:1"));
 assert.ok(finding.length);
 assert.match(JSON.stringify(finding), /red/i, "The real model must identify the visible highest bar, absent from the caption.");
 assert.match(JSON.stringify(finding), /29/, "The real model must read the visible red bar value, absent from the caption.");
 assert.ok(finding.some(item=>item.status!=="pass"), "The intentionally false caption must be flagged.");
 const output=resolve(".local/checks/skeleton-images-live");await mkdir(output,{recursive:true});
 await writeFile(join(output,"result.json"),JSON.stringify(result,null,2));await writeFile(join(output,"synthetic.png"),png);
 console.log(JSON.stringify({live:true,verdict:result.structured.verdict,figureFindings:finding,output}));
} else {
 const original=process.env.DATABASE_URL!, source=createPostgresClient("skeleton-images-isolation");
 const database="skeleton_images_"+randomUUID().replaceAll("-","");const directory=await mkdtemp(join(tmpdir(),"skeleton-images-"));
 const originalFetch=globalThis.fetch;let created=false,calls=0,changeDuringGeneration:(()=>Promise<void>)|undefined;
 let imageCitations=["figure:1"];
 try {
  await source.pool.query(`CREATE DATABASE "${database}"`);created=true;const url=new URL(original);url.pathname="/"+database;
  Object.assign(process.env,{DATABASE_URL:url.toString(),DATASTORE_DIR:directory,AUTH_SECRET:"synthetic-images",VIOSCOPE_RUNTIME_CONFIG_CACHE_PATH:join(directory,"runtime.json"),VIOS_SKILLS_DIR:join(directory,"skills"),ELM_BASE_URL:"https://synthetic.invalid/v1",ELM_API_KEY:"synthetic"});
  const skillDir=join(directory,"skills/vios-skeleton-lock");await mkdir(skillDir,{recursive:true});await writeFile(join(skillDir,"SKILL.md"),"---\nname: vios-skeleton-lock\ncategory: Review & Dissemination\ndescription: Use this skill to test a synthetic Skeleton Lock review with supplied visual evidence, captions, uncertainty and separate human decisions.\nversion: 1.0.0\n---\nReview the supplied evidence. Never grant human approval.\n");
  const users=await import("../src/mastra/db/users");await users.ensureUsersTable();const db=createPostgresClient();
  for(const [name,role] of [["owner","member"],["reviewer","member"],["outsider","member"],["principal","pi"]])await db.pool.query("INSERT INTO users(id,username,display_name,email,role,provisioning_status,password_reset_required) VALUES($1,$2,$2,$3,$4,$5,false)",[randomUUID(),name,name+"@example.test",role,"active"]);
  const owner=(await users.getUserByUsername("owner"))!,reviewer=(await users.getUserByUsername("reviewer"))!,outsider=(await users.getUserByUsername("outsider"))!;
  const projects=await import("../src/mastra/db/projects");const project=await projects.createProject({title:"Synthetic image review",stage:4,pdraUsername:"reviewer",piUsername:"principal"},owner);
  const {createSessionToken,sessionCookieName}=await import("../src/mastra/auth/session");const route=await import("../app/api/skeleton-lock/route");const detail=await import("../app/api/skeleton-lock/[reviewId]/route");
  let modelRequest:any;
  globalThis.fetch=async(_input,init)=>{calls++;modelRequest=JSON.parse(String(init?.body));if(changeDuringGeneration)await changeDuringGeneration();return new Response(JSON.stringify({id:"resp_synthetic",created_at:1,model:"synthetic",status:"completed",output:[{id:"msg_synthetic",type:"message",role:"assistant",status:"completed",content:[{type:"output_text",text:JSON.stringify({verdict:"CONDITIONAL",summary:"Synthetic figure requires caption correction.",findings:[{area:"Figure 1",status:"partial",evidence:imageCitations,gap:"Red is tallest; the caption says blue.",requiredAction:"Correct the caption."}],reasonsToReject:[],checkmateQuestions:[],mitigations:[],humanSignOff:{leadPdra:"pending",piOrOrganizer:"pending",remainingEvidenceNeeded:[]},perSkillNotes:[]}),annotations:[]}]}],usage:{input_tokens:100,output_tokens:100,total_tokens:200}}),{headers:{"content-type":"application/json"}});};
  const cookie=(user=owner)=>({cookie:`${sessionCookieName}=${createSessionToken(user)}`});
  const post=(user=owner,form=formFor())=>{form.set("projectId",project.id);form.set("mode","blocks");if(!form.has("blocks"))form.set("blocks",JSON.stringify(skeletonDraftSchema.parse({})));return route.POST(new Request("http://localhost/api/skeleton-lock",{method:"POST",headers:cookie(user),body:form}));};
  assert.equal((await route.POST(new Request("http://localhost/api/skeleton-lock",{method:"POST"}))).status,401);
  assert.notEqual((await post(outsider)).status,200);assert.equal((await post(reviewer)).status,403);assert.equal(calls,0);
  assert.equal((await post(owner,formFor(upload(Buffer.from("bad"))))).status,400);assert.equal(calls,0);
  const response=await post();assert.equal(response.status,200,await response.clone().text());const {review}=await response.json();
  const content=modelRequest.input.flatMap((item:any)=>item.content||[]);const image=content.find((item:any)=>item.type==="input_image");assert.equal(image.image_url,figures[0].dataUrl);
  assert.ok(content.some((item:any)=>item.type==="input_text"&&item.text.includes(caption)));assert.match(review.draftText,/figure:1/);assert.equal(review.result.figureInputs[0].sha256,figures[0].sha256);assert.equal(review.decisions.length,0);
  const context={params:Promise.resolve({reviewId:review.id})};
  const get=(user=owner)=>detail.GET(new Request("http://localhost/review",{headers:cookie(user)}),context);
  assert.equal((await get(outsider)).status,404);assert.deepEqual((await (await get(reviewer)).json()).review.result.figureInputs,review.result.figureInputs);
  const list=await (await route.GET(new Request("http://localhost/reviews",{headers:cookie()}))).json();assert.ok(!JSON.stringify(list).includes("data:image"),"The list does not carry image bytes.");
  const count=async()=>Number((await db.pool.query("SELECT count(*) FROM skeleton_reviews")).rows[0].count);
  imageCitations=[];assert.equal((await post()).status,400);assert.equal(await count(),1,"Missing visual review is never saved.");
  imageCitations=["figure:1","figure:99"];assert.equal((await post()).status,400);assert.equal(await count(),1);
  const pair=()=>{const form=formFor();form.append("figures",upload());form.append("figureCaptions","Second synthetic image.");return form;};
  imageCitations=["figure:1"];assert.equal((await post(owner,pair())).status,400,"Every image needs its own cited finding.");assert.equal(await count(),1);
  imageCitations=["figure:1"];changeDuringGeneration=async()=>{await projects.updateProject(project.id,{target:"Changed during generation"},owner);};
  assert.equal((await post()).status,409);assert.equal(await count(),1,"Stale image results are never saved.");changeDuringGeneration=undefined;
  await projects.updateProject(project.id,{pdraUsername:null},owner);assert.equal((await get(reviewer)).status,404,"Revoked access also revokes saved images.");
  assert.equal((await projects.getProjectForUser(project.id,owner)).stage,4);
  assert.equal((await get()).status,200);
  imageCitations=["figure:1","figure:2"];const paired=await post(owner,pair());assert.equal(paired.status,200,await paired.clone().text());assert.equal((await paired.json()).review.result.figureInputs.length,2);
  imageCitations=["missing"];const textOnly=new FormData();textOnly.set("blocks",JSON.stringify(skeletonDraftSchema.parse({claim:"Synthetic text-only evidence."})));const textResponse=await post(owner,textOnly);assert.equal(textResponse.status,200,await textResponse.clone().text());assert.equal((await textResponse.json()).review.result.figureInputs,undefined);
  console.log("Skeleton image checks passed: valid PNG/JPEG/WebP, captions and limits, decoding and pixel bounds, bounded multipart, multimodal payload, immutable snapshots, authorisation, access revocation, failed image citations and stale results.");
 } finally {globalThis.fetch=originalFetch;await closePostgresPools(process.env.DATABASE_URL);if(created)await source.pool.query(`DROP DATABASE "${database}" WITH (FORCE)`);await closePostgresPools(original);await rm(directory,{recursive:true,force:true});}
}
