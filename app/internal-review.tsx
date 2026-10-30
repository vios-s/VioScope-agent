'use client';
import {supersededReviewTask} from '../src/mastra/submission/internal-review';
import { useEffect, useState, useId, useRef, type ReactNode, type KeyboardEvent, type FormEvent, type TextareaHTMLAttributes, type SelectHTMLAttributes } from 'react';
import {ReviewPdfUpload} from './internal-review-upload';
import {RedTeamPanel} from './internal-red-team';
import {projectPIs,projectPDRAs} from '../src/mastra/projects/review-team';
import { ChevronDown } from 'lucide-react';
import { ApiRequestError, requestJson } from './client-request';
import { formatDayTime, formatDay } from './format';
import { internalChecklist, type InternalReviewCommand, type MetaReview } from '../src/mastra/submission/internal-review';
import type { getInternalReviews } from '../src/mastra/db/internal-reviews';
import type { ProjectTask, WorkflowCommand } from '../src/mastra/projects/workflow';
type Payload=Awaited<ReturnType<typeof getInternalReviews>>;
type Round=Payload['rounds'][number];
const value=(form:FormData,key:string)=>String(form.get(key)||'').trim();
const emptyReview=():MetaReview=>({summary:'',score:5,confidence:3,strengths:'',weaknesses:'',questions:'',checklist:internalChecklist.map(([key])=>({key,verdict:'no',evidence:''})),changes:[]});

function TextAreaField({label,number,...props}:TextareaHTMLAttributes<HTMLTextAreaElement>&{label:string;number?:number}) {
  const id=useId();return <div className={number?'checklist-block':'ir-field'}>{number?<div className="checklist-block-head"><span className="checklist-block-num" aria-hidden="true">{String(number).padStart(2,'0')}</span><label htmlFor={id}>{label}</label></div>:<label htmlFor={id}>{label}</label>}<textarea id={id} rows={4} {...props}/></div>;
}

function SelectField({label,children,...props}:SelectHTMLAttributes<HTMLSelectElement>&{label:string}) {
  const id=useId();return <div className="ir-select-field"><label htmlFor={id}>{label}</label><select id={id} {...props}>{children}</select></div>;
}

function ReviewForm({children,label,onSave,disabled=false,confirm=false}:{children:ReactNode;label:string;onSave:(data:FormData)=>Promise<void>;disabled?:boolean;confirm?:boolean}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();const form=event.currentTarget;setBusy(true);setError('');try{await onSave(new FormData(form));form.reset();}catch(e){setError(e instanceof Error?e.message:'Could not save.');}finally{setBusy(false);}}
  return <form onSubmit={submit}><fieldset disabled={busy||disabled}>{children}{confirm&&<label className="checklist-confirm"><input required type="checkbox"/>I confirm this action and the recorded evidence.</label>}{error&&<p className="ops-notice error" role="alert">{error}</p>}<button className="ops-primary" type="submit">{busy?'Saving…':label}</button></fieldset></form>;
}

type ProjectListItem={id:string;title:string;ownerUsername:string;stage:number};
export function InternalReview({focusProjectId,embedded=false}:{focusProjectId?:string|null;embedded?:boolean}) {
  const [projects,setProjects]=useState<ProjectListItem[]>([]),[projectId,setProjectId]=useState(focusProjectId||''),[error,setError]=useState(''),[loading,setLoading]=useState(true),[search,setSearch]=useState(''),[listOpen,setListOpen]=useState(!focusProjectId);
  const listId=useId(),recordRef=useRef<HTMLDivElement>(null);
  useEffect(()=>{if(embedded)return;let active=true;void requestJson<{projects:ProjectListItem[]}>('/api/projects','Could not load projects.').then(data=>{if(active)setProjects(data.projects);}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[embedded]);
  useEffect(()=>{if(focusProjectId)setProjectId(focusProjectId);},[focusProjectId]);
  const matching=projects.filter(p=>`${p.title} @${p.ownerUsername}`.toLowerCase().includes(search.trim().toLowerCase()));
  const project=projects.find(p=>p.id===projectId);
  if(embedded)return <section className="checklist-panel internal-review ir-embedded">{projectId&&<ReviewProject key={projectId} projectId={projectId}/>}</section>;
  return <section className="checklist-panel internal-review">
    {error&&<p className="ops-notice error checklist-page-notice" role="alert">{error}</p>}
    <div className="checklist-workspace">
      <aside className="checklist-list" aria-label="Internal review projects">
        <button type="button" className="checklist-list-toggle" aria-expanded={listOpen} aria-controls={listId} onClick={()=>setListOpen(open=>!open)}><span>{listOpen?'Hide projects':`Projects (${projects.length})`}</span>{!listOpen&&<small>{project?`Open: ${project.title}`:'Choose a project'}</small>}<ChevronDown aria-hidden="true"/></button>
        <div id={listId} className="checklist-list-body" data-open={listOpen}>
          <div className="checklist-list-filters"><label>Find a project<input type="search" placeholder="Project or @owner" value={search} onChange={e=>setSearch(e.target.value)}/></label></div>
          <p className="vs-sr-only" role="status">{loading?'Loading projects…':`${matching.length} projects found.`}</p>
          <div className="checklist-list-group"><h2 className="vs-caps">Projects</h2><ul>{matching.map(p=><li key={p.id}><button type="button" data-project-id={p.id} className={`checklist-list-item${p.id===projectId?' active':''}`} aria-current={p.id===projectId?'true':undefined} onClick={()=>{setProjectId(p.id);setListOpen(false);recordRef.current?.focus();}}><span>{p.title}</span><small>@{p.ownerUsername} · Stage {p.stage}</small></button></li>)}</ul></div>
          {!loading&&!matching.length&&<p className="checklist-list-note">{projects.length?'No projects match this search.':'Create or join a project before starting Internal Review.'}</p>}
        </div>
        <p className="checklist-list-note">Revision tasks also appear in Projects.</p>
      </aside>
      <div className="checklist-record-host" ref={recordRef} tabIndex={-1} aria-label="Selected project review" data-project-id={projectId}>
        {projectId?<ReviewProject key={projectId} projectId={projectId}/>:<div className="ops-empty checklist-empty"><strong>Choose a project</strong><span>Select a project to review its manuscript.</span></div>}
      </div>
    </div>
  </section>;
}
function ReviewProject({projectId}:{projectId:string}) {
  const [data,setData]=useState<Payload|null>(null),[error,setError]=useState(''),[message,setMessage]=useState(''),[selected,setSelected]=useState(''),[view,setView]=useState<'reviews'|'revisions'|'ai'>('reviews');
  const tabId=useId();
  const url=`/api/projects/${projectId}/internal-review`;
  async function load(){const next=await requestJson<Payload>(url,'Could not load internal reviews.');setData(next);return next;}
  useEffect(()=>{let active=true;void requestJson<Payload>(url,'Could not load internal reviews.').then(next=>{if(active)setData(next);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[url]);
  async function save(command:InternalReviewCommand){
    try {await requestJson(url,'Could not save review.',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(command)});}
    catch(error){if(error instanceof ApiRequestError&&error.status===409){await load();throw new Error('The round changed. Your text is kept; check the latest records and retry.');}throw error;}
    await load();setMessage('Saved.');
  }
  async function workflow(command:WorkflowCommand){await requestJson(`/api/projects/${projectId}/workflow`,'Could not save project record.',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(command)});await load();setMessage('Project record saved.');}
  if(!data)return <p className={error?'ops-notice error':'checklist-hint'} role={error?'alert':'status'}>{error||'Loading reviews…'}</p>;
  const round=data.rounds.find(r=>r.id===selected)||data.rounds[0];
  const docs=data.evidence.filter(e=>e.data.state==='completed');
  return <div className="checklist-record ir-record">
    <div className="checklist-record-main">
    <header className="checklist-record-head">
      <span className="checklist-record-label">Project · Internal Review</span><h2 className="checklist-record-title">{data.project.title}</h2>
      <div className="checklist-record-meta"><span>Owner: @{data.project.ownerUsername}</span><span>Required PDRA: {data.project.pdraUsername?`@${data.project.pdraUsername}`:'Not assigned'}</span><span>PIs: {projectPIs(data.project).map(u=>`@${u}`).join(', ')||'Not assigned'}</span><span>Other PDRAs: {projectPDRAs(data.project).filter(u=>u!==data.project.pdraUsername).map(u=>`@${u}`).join(', ')||'None'}</span></div>
      {data.submission&&<p className="checklist-hint">{data.submission.plan.venue} · Deadline <span className="vs-mono">{new Intl.DateTimeFormat('en-GB',{timeZone:data.submission.plan.timezone,dateStyle:'medium',timeStyle:'short'}).format(new Date(data.submission.plan.deadline))}</span> ({data.submission.plan.timezone})</p>}
    </header>
    {!data.submission&&<p className="ops-notice">First add a plan in Projects → Details → Submissions.</p>}
    {message&&<p className="form-message" role="status">{message}</p>}
    {data.viewer.canStart&&data.submission&&<ReviewPdfUpload projectId={projectId} submissionId={data.submission.id} previousRoundId={data.rounds[0]?.id||null} onSaved={async id=>{await load();setSelected(id);setView('ai');setMessage('PDF saved to project materials and evidence. Review round started.');}}/>}
    {data.viewer.canStart&&<details className="checklist-import"><summary>Add manuscript or revision evidence</summary><p className="checklist-hint">Select an existing project file or a version-specific URL. To upload a new paper directly, use Upload a manuscript PDF.</p>
      <ReviewForm label="Save document evidence" onSave={form=>workflow({operation:'evidence',confirmed:true,title:value(form,'title'),claim:'Internal review manuscript or revision evidence',kind:'document',state:'completed',summary:value(form,'summary'),artifactId:value(form,'artifactId')||null,url:value(form,'url')||null})}>
        <label>Document title and version<input name="title" required maxLength={200}/></label><TextAreaField label="Evidence summary" name="summary" required maxLength={4000}/>
        <SelectField label="Project material" name="artifactId"><option value="">No material selected</option>{data.project.artifacts.map(a=><option key={a.id} value={a.id}>{a.title} · {formatDayTime(a.createdAt)}</option>)}</SelectField>
        <label>Version-specific document URL<input name="url" type="url" placeholder="https://…"/></label>
      </ReviewForm></details>}
    {data.viewer.canStart&&data.submission&&<details className="checklist-import" open={!round}><summary>{round?'Submit a new manuscript round':'Submit manuscript for review'}</summary><p className="checklist-hint">Starts an AI Red-Team check and requires a new PDRA review. Earlier rounds and tasks are kept.</p>
      <ReviewForm label="Submit manuscript for review" confirm onSave={async form=>{await save({operation:'start',confirmed:true,submissionId:data.submission.id,previousRoundId:data.rounds[0]?.id||null,manuscript:{label:value(form,'label'),evidenceId:value(form,'evidenceId')}});setSelected('');}}>
        <ManuscriptFields evidence={docs}/>
      </ReviewForm></details>}
    {round&&<>
      <div className="ir-round"><SelectField label="Review round" value={round.id} onChange={e=>setSelected(e.target.value)}>{data.rounds.map(r=><option key={r.id} value={r.id}>{r.data.manuscript.label} · {formatDayTime(r.createdAt)}</option>)}</SelectField>
      <p className="checklist-hint"><span className={`checklist-status is-${round.current?'accent':'warn'}`}>{round.current?'Current round':'Historical round'}</span> · Submitted {formatDayTime(round.createdAt)}<br/>Required review due {formatDayTime(new Date(Date.parse(round.createdAt)+48*3600000).toISOString())}</p>
      {!round.current&&<p className="checklist-hint">Start a new round after changes to the submission plan or project context.</p>}
      <EvidenceLink id={round.data.manuscript.evidenceId} evidence={data.evidence}/>
      </div>
      <div className="console-page-tabs ir-tabs" role="tablist" aria-label="Internal review sections" onKeyDown={reviewTabsKeyDown}>
        {([['reviews','Reviews'],['revisions','Revision Tracker'],['ai','AI Internal Red-Team']] as const).map(([key,label])=><button key={key} type="button" role="tab" id={`${tabId}-${key}`} aria-controls={`${tabId}-${key}-panel`} aria-selected={view===key} tabIndex={view===key?0:-1} className={view===key?'active':''} onClick={()=>setView(key)}>{label}</button>)}
      </div>
      <div role="tabpanel" id={`${tabId}-reviews-panel`} aria-labelledby={`${tabId}-reviews`} hidden={view!=='reviews'}><Reviews key={round.id} data={data} round={round} save={save}/></div>
      <div role="tabpanel" id={`${tabId}-revisions-panel`} aria-labelledby={`${tabId}-revisions`} hidden={view!=='revisions'}><Revisions data={data} round={round} save={save} workflow={workflow}/></div>
      <div role="tabpanel" id={`${tabId}-ai-panel`} aria-labelledby={`${tabId}-ai`} hidden={view!=='ai'}><RedTeamPanel projectId={projectId} round={round} canRun={data.viewer.owner||data.viewer.lead||data.viewer.pi} onRefresh={load}/></div>
    </>}
    </div>
    <aside className="checklist-rail ir-rail" aria-label="Review workflow">
      <section className="checklist-step"><h3>Review workflow</h3><ol className="ir-stages">
        <li><span className="checklist-block-num" aria-hidden="true">01</span><div><strong>Internal Review</strong><p>Assigned PDRA reviews within 48 hours.</p></div></li>
        <li><span className="checklist-block-num" aria-hidden="true">02</span><div><strong>Revision Lock</strong><p>Assigned PDRA verifies required revisions.</p></div></li>
        <li><span className="checklist-block-num" aria-hidden="true">03</span><div><strong>Final PI clearance</strong><p>PI decides after Revision Lock.</p></div></li>
      </ol></section>
      {round&&<ReviewerRoster data={data} round={round} save={save}/>}
    </aside>
  </div>;
}
function ManuscriptFields({evidence}:{evidence:Payload['evidence']}) {return <><label>Manuscript version label<input name="label" required maxLength={200} placeholder="Manuscript v1"/></label><SelectField label="Manuscript evidence" name="evidenceId" required><option value="">Select completed document evidence</option>{evidence.map(e=><option key={e.id} value={e.id}>{e.data.title}</option>)}</SelectField></>;}
function EvidenceLink({id,evidence}:{id:string;evidence:Payload['evidence']}) {const e=evidence.find(e=>e.id===id);return e?<p>{e.data.url?<a href={e.data.url} target="_blank" rel="noreferrer">{e.data.title}</a>:<span>{e.data.title} · Project material</span>}</p>:null;}
type Actions={data:Payload;round:Round;save:(command:InternalReviewCommand)=>Promise<void>};
function ReviewerRoster({data,round,save}:Actions) {
  const base={roundId:round.id,revision:round.revision,confirmed:true as const};
  const people=[...new Set([round.data.pdra,...projectPDRAs(data.project),...data.project.collaborators,...round.data.invited,...Object.values(round.data.reviews).map(r=>r.username),...projectPIs(data.project)])].filter(u=>u!==data.project.ownerUsername);
  return <section className="checklist-step"><h3>Reviewers</h3>
    <ul className="checklist-advice-list">{people.map(username=>{const submitted=Object.values(round.data.reviews).some(r=>r.username===username&&r.versions.length);return <li key={username}><div className="checklist-advice-row"><strong>@{username}</strong><span className={`checklist-status is-${submitted?'ok':'warn'}`}>{submitted?'Submitted':'Pending'}</span></div><span className="checklist-hint">{username===round.data.pdra?'Required lead PDRA':projectPDRAs(data.project).includes(username)?'Optional PDRA':projectPIs(data.project).includes(username)?'Project PI · optional review':'Optional reviewer'}</span></li>;})}</ul>
    {round.current&&(data.viewer.canInvite||data.viewer.lead)&&<details><summary>Invite an optional reviewer</summary><ReviewForm label="Invite reviewer" onSave={form=>save({operation:'invite',...base,username:value(form,'username')})}><label>Existing account username<input name="username" required/></label><p>Requires existing project access; invitations grant none.</p></ReviewForm></details>}
  </section>;
}
function Reviews({data,round,save}:Actions) {
  const own=Object.values(round.data.reviews).find(r=>r.username===data.viewer.username);
  const base={roundId:round.id,revision:round.revision,confirmed:true as const};
  return <>
    {round.canReview&&<MetaReviewEditor key={round.id} initial={own?.draft||own?.versions.at(-1)?.content||emptyReview()} onSave={(content,publish)=>save({operation:'review',...base,content,publish})}/>}
    {data.viewer.owner&&<p className="checklist-step-state">Reviews are read only. You can respond and complete revisions.</p>}
    {!Object.values(round.data.reviews).some(r=>r.versions.length)&&<p className="checklist-hint">No reviews submitted yet. Reviewer drafts are private.</p>}
    {Object.entries(round.data.reviews).filter(([,r])=>r.versions.length).map(([id,review])=><article className="ir-card" key={id}><h3>@{review.username} · {review.username===round.data.pdra?'Required PDRA review':'Optional review'}</h3>
      <ReviewContent version={review.versions.at(-1)!}/>
      {review.versions.length>1&&<details><summary>Earlier submitted versions</summary>{review.versions.slice(0,-1).map(v=><ReviewContent key={v.version} version={v}/>)}</details>}
      <h4>Owner responses</h4>{round.data.responses.filter(r=>r.reviewId===id).map((r,i)=><p className="ir-prose" key={i}>@{r.by} · {formatDayTime(r.at)}<br/>{r.text}</p>)}
      {round.current&&data.viewer.owner&&<ReviewForm label="Submit response" onSave={form=>save({operation:'respond',...base,reviewId:id,text:value(form,'response')})}><TextAreaField label={`Response to @${review.username}`} name="response" required maxLength={8000}/></ReviewForm>}
    </article>)}
  </>;
}
function ReviewContent({version}:{version:NonNullable<Round['data']['reviews'][string]['versions'][number]>}) {
  const content=version.content;
  return <><p className="checklist-hint">Version {version.version} · {formatDayTime(version.at)} · Score {content.score}/10 · Confidence {content.confidence}/5</p>
    {(['summary','strengths','weaknesses','questions'] as const).map(k=><div key={k}><h4>{({summary:'Summary and contribution',strengths:'Strengths',weaknesses:'Weaknesses',questions:'Checkmate questions'})[k]}</h4><p className="ir-prose">{content[k]||'None recorded.'}</p></div>)}
    <details><summary>Evidence-based checklist</summary><ul>{content.checklist.map(c=><li key={c.key}>{internalChecklist.find(([k])=>k===c.key)?.[1]} <strong>{c.verdict.replaceAll('_',' ')}</strong><p className="ir-prose">{c.evidence}</p></li>)}</ul></details>
    <h4>Requested revisions</h4>{content.changes.length?<ol>{content.changes.map(c=><li key={c.id}>{c.text}<p className="ir-prose">Evidence: {c.evidence}</p></li>)}</ol>:<p>No revision items requested.</p>}
  </>;
}
function MetaReviewEditor({initial,onSave}:{initial:MetaReview;onSave:(content:MetaReview,publish:boolean)=>Promise<void>}) {
  const [content,setContent]=useState(initial),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  async function send(publish:boolean){setBusy(true);setError('');setMessage('');try{await onSave(content,publish);setMessage(publish?'Review submitted.':'Private draft saved.');}catch(e){setError(e instanceof Error?e.message:'Could not save.');}finally{setBusy(false);}}
  return <details className="checklist-import ir-editor"><summary>Write your Meta-Review</summary><form onSubmit={e=>{e.preventDefault();void send(true);}}><fieldset disabled={busy}>
    <p className="checklist-hint">Private draft; submission shares it with project readers.</p>
    {(['summary','strengths','weaknesses','questions'] as const).map((k,index)=><TextAreaField key={k} number={index+1} label={({summary:'Summary and contribution',strengths:'Primary strengths',weaknesses:'Primary weaknesses',questions:'Checkmate questions'})[k]} required={k!=='questions'} maxLength={8000} value={content[k]} onChange={e=>setContent(c=>({...c,[k]:e.target.value}))}/>)}
    <div className="checklist-field-grid"><label>Likely rating (1–10)<input type="number" required min={1} max={10} value={content.score} onChange={e=>setContent(c=>({...c,score:Number(e.target.value)}))}/></label><label>Confidence (1–5)<input type="number" required min={1} max={5} value={content.confidence} onChange={e=>setContent(c=>({...c,confidence:Number(e.target.value)}))}/></label></div>
    <div className="checklist-block-head"><span className="checklist-block-num" aria-hidden="true">05</span><h3>PDRA checklist</h3></div>{internalChecklist.map(([key,title])=>{const item=content.checklist.find(c=>c.key===key)||{key,verdict:'no' as const,evidence:''};const update=(patch:Partial<typeof item>)=>setContent(c=>({...c,checklist:[...c.checklist.filter(i=>i.key!==key),{...item,...patch}]}));return <fieldset className="ir-check" key={key}><legend>{title}</legend><SelectField label="Assessment" value={item.verdict} onChange={e=>update({verdict:e.target.value as typeof item.verdict})}><option value="no">Not yet satisfied</option><option value="yes">Satisfied</option><option value="not_applicable">Not applicable</option></SelectField><TextAreaField label="Draft evidence or reason" required value={item.evidence} maxLength={8000} onChange={e=>update({evidence:e.target.value})}/></fieldset>;})}
    <div className="checklist-block-head"><span className="checklist-block-num" aria-hidden="true">06</span><h3>Requested revisions</h3></div>{content.changes.map((change,i)=><fieldset className="ir-check" key={change.id}><legend>Revision {i+1}</legend><TextAreaField label="Required change" required value={change.text} maxLength={8000} onChange={e=>setContent(c=>({...c,changes:c.changes.map(item=>item.id===change.id?{...item,text:e.target.value}:item)}))}/><TextAreaField label="Evidence in the draft" required value={change.evidence} maxLength={8000} onChange={e=>setContent(c=>({...c,changes:c.changes.map(item=>item.id===change.id?{...item,evidence:e.target.value}:item)}))}/><button type="button" className="ops-secondary" onClick={()=>setContent(c=>({...c,changes:c.changes.filter(item=>item.id!==change.id)}))}>Remove revision {i+1}</button></fieldset>)}
    <button type="button" className="ops-secondary" disabled={content.changes.length>=30} onClick={()=>setContent(c=>({...c,changes:[...c.changes,{id:crypto.randomUUID(),text:'',evidence:''}]}))}>Add revision item</button>
    <label className="checklist-confirm"><input required type="checkbox"/>I confirm this independent assessment and its evidence.</label>
    {error&&<p className="ops-notice error" role="alert">{error}</p>}{message&&<p className="form-message" role="status">{message}</p>}
    <div className="checklist-action-bar"><span className="checklist-bar-state is-idle">{busy?'Saving…':'Only submitted reviews are shared'}</span><button type="button" className="ops-secondary" onClick={()=>void send(false)}>Save private draft</button><button type="submit" className="ops-primary">Submit review</button></div>
  </fieldset></form></details>;
}

function Revisions({data,round,save,workflow}:Actions&{workflow:(command:WorkflowCommand)=>Promise<void>}) {
  const base={roundId:round.id,revision:round.revision,confirmed:true as const};
  const tasks=data.tasks.filter(t=>round.current||t.sourceId===round.id);
  return <>
    <div className="checklist-block"><div className="checklist-block-head"><span className="checklist-block-num" aria-hidden="true">01</span><h3>Revision Tracker</h3></div><p className="checklist-hint">Required revisions need evidence and PDRA acceptance. Suggested revisions do not block approval.</p></div>
    {Object.entries(round.data.reviews).flatMap(([reviewId,review])=>review.versions.map(version=><details key={`${reviewId}:${version.version}`} open={version===review.versions.at(-1)}><summary>@{review.username} · Review v{version.version}{version!==review.versions.at(-1)?' · Historical':''}</summary>
      {version.content.changes.map(finding=>{const disposition=round.data.dispositions.find(d=>d.reviewId===reviewId&&d.version===version.version&&d.findingId===finding.id);return <article className="ir-card" key={finding.id}><h4>{finding.text}</h4><p className="ir-prose">Evidence: {finding.evidence}</p><p>{disposition?`${disposition.kind} · @${disposition.by}: ${disposition.reason}`:'Awaiting PDRA classification'}</p>
        {round.current&&data.viewer.lead&&<details><summary>Classify or revise requirement</summary><ReviewForm label="Save revision requirement" onSave={form=>save({operation:'triage',...base,reviewId,version:version.version,findingId:finding.id,kind:value(form,'kind') as 'required'|'suggested'|'declined',reason:value(form,'reason'),owner:value(form,'owner'),dueDate:value(form,'dueDate')||null})}>
          <SelectField label="Classification" name="kind" defaultValue={disposition?.kind||'required'}><option value="required">Required</option><option value="suggested">Suggested</option><option value="declined">Declined with reason</option></SelectField><TextAreaField label="Reason and resolution of conflicting advice" required name="reason" defaultValue={disposition?.reason||''}/><label>Assignee username<input required name="owner" defaultValue={data.project.ownerUsername}/></label><label>Due date<input name="dueDate" type="date"/></label>
        </ReviewForm></details>}
      </article>;})}
    </details>))}
    <div className="checklist-block-head"><span className="checklist-block-num" aria-hidden="true">02</span><h3>Shared project tasks</h3></div>{!tasks.length&&<p>No revision tasks have been created.</p>}
    {tasks.map(task=><RevisionTask key={`${task.id}:${task.revision}`} task={task} data={data} round={round} save={save} workflow={workflow}/>)}
    <section className="ir-card checklist-step"><div className="checklist-block-head"><span className="checklist-block-num" aria-hidden="true">03</span><h3>Revision Lock</h3></div><p className={`checklist-status is-${round.lockValid?'ok':'warn'}`}>{round.lockValid?'Passed — current reviews and tasks verified.':round.data.lock?'Previous pass is historical; reviews, tasks or project context changed.':'Not passed.'}</p>
      {round.blockers.length>0&&<ul>{round.blockers.map((b,i)=><li key={i}>{b}</li>)}</ul>}
      {round.data.lock&&<><p>@{round.data.lock.by} · {formatDayTime(round.data.lock.at)} · {round.data.lock.reason}</p><EvidenceLink id={round.data.lock.finalManuscript.evidenceId} evidence={data.evidence}/></>}
      {round.current&&data.viewer.lead&&!round.blockers.length&&<ReviewForm label="Pass Revision Lock" confirm onSave={form=>save({operation:'lock',...base,reason:value(form,'reason'),finalManuscript:{label:value(form,'label'),evidenceId:value(form,'evidenceId')}})}><ManuscriptFields evidence={data.evidence.filter(e=>e.data.state==='completed')}/><TextAreaField label="Verification and remaining limitations" name="reason" required/></ReviewForm>}
    </section>
    <section className="ir-card checklist-step ir-clearance"><div className="checklist-block-head"><span className="checklist-block-num" aria-hidden="true">04</span><h3>Final PI clearance</h3></div><p className={`checklist-status is-${round.clearanceValid?'ok':'warn'}`}>{round.clearanceValid?'Approved for submission.':round.data.clearance?.outcome==='defer'&&round.lockValid?'Deferred by PI.':round.data.clearance?'Previous clearance is historical; fresh confirmation is required.':'Awaiting final PI decision.'}</p>
      {round.data.clearance&&<p>@{round.data.clearance.by} · {formatDayTime(round.data.clearance.at)} · {round.data.clearance.reason}</p>}
      {!round.lockValid&&<p>Pass Revision Lock before final PI clearance.</p>}
      {round.lockValid&&data.viewer.pi&&<ReviewForm label="Record final PI clearance" confirm onSave={form=>save({operation:'clearance',...base,outcome:value(form,'outcome') as 'submit'|'defer',reason:value(form,'reason')})}><SelectField label="PI decision" name="outcome"><option value="submit">Approve submission</option><option value="defer">Emergency deferral</option></SelectField><TextAreaField label="Reason and evidence assessment" name="reason" required/></ReviewForm>}
      {round.lockValid&&!round.clearanceValid&&!data.viewer.pi&&<p>An assigned PI other than the owner, or an independent administrator, must record the final decision.</p>}
    </section>
  </>;
}
function RevisionTask({task,data,round,save,workflow}:{task:ProjectTask}&Actions&{workflow:(command:WorkflowCommand)=>Promise<void>}) {
  const editable=round.current&&task.data.status!=='cancelled'&&(data.viewer.owner||task.data.owner===data.viewer.username);
  return <article className="ir-card"><h4>{task.data.task}</h4><p>@{task.data.owner} · {task.data.priority==='high'?'Required':'Suggested'} · {task.data.status.replaceAll('_',' ')} · Due {formatDay(task.data.dueDate,'not set')}</p><p className="ir-prose">{task.data.note}</p>
    {task.sourceId!==round.id&&<p>Carried forward from an earlier review round.</p>}
    <p>{task.data.verification?.accepted&&task.data.verification.revision===task.revision?`Accepted by @${task.data.verification.by}`:'Not accepted by PDRA'}</p>
    {task.data.evidenceIds.map(id=><EvidenceLink key={id} id={id} evidence={data.evidence}/>)}
    {editable&&<details><summary>Update progress and evidence</summary><ReviewForm label="Save revision progress" onSave={form=>workflow({operation:'task_update',confirmed:true,id:task.id,revision:task.revision,status:value(form,'status') as 'open'|'in_progress'|'blocked'|'done',note:value(form,'note'),evidenceIds:form.getAll('evidenceIds').map(String)})}><SelectField label="Status" name="status" defaultValue={task.data.status==='cancelled'?'open':task.data.status}>{['open','in_progress','blocked','done'].map(s=><option value={s} key={s}>{s.replaceAll('_',' ')}</option>)}</SelectField><TextAreaField label="Completion evidence or progress" required name="note" defaultValue={task.data.note}/><fieldset><legend>Completed evidence</legend>{data.evidence.filter(e=>e.data.state==='completed').map(e=><label className="checklist-confirm" key={e.id}><input type="checkbox" name="evidenceIds" value={e.id} defaultChecked={task.data.evidenceIds.includes(e.id)}/>{e.data.title}</label>)}</fieldset></ReviewForm></details>}
    {round.current&&data.viewer.lead&&<details><summary>PDRA verification</summary><ReviewForm label="Record PDRA verification" confirm onSave={form=>save({operation:'verify',roundId:round.id,revision:round.revision,confirmed:true,taskId:task.id,taskRevision:task.revision,accepted:value(form,'accepted')==='yes',reason:value(form,'reason')})}><SelectField label="Verification" name="accepted"><option value="yes">Accept completed revision</option><option value="no">Return for further work</option></SelectField><TextAreaField label="Verification evidence and reason" required name="reason"/></ReviewForm></details>}
    {round.current&&data.viewer.lead&&supersededReviewTask(round,task)&&task.data.status!=='cancelled'&&<details><summary>Retire superseded requirement</summary><ReviewForm label="Retire superseded requirement" confirm onSave={form=>save({operation:'retire_task',roundId:round.id,revision:round.revision,confirmed:true,taskId:task.id,taskRevision:task.revision,reason:value(form,'reason')})}><TextAreaField label="Reason this requirement no longer applies" required name="reason"/></ReviewForm></details>}
    <details><summary>Task history</summary>{task.data.history.map((h,i)=><p className="ir-prose" key={i}>@{h.by} · {formatDayTime(h.at)} · {h.status}: {h.note}</p>)}</details>
  </article>;
}

function reviewTabsKeyDown(event:KeyboardEvent<HTMLElement>) {
  if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
  const tabs=Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
  const index=tabs.indexOf(event.target as HTMLButtonElement);if(index<0)return;
  event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
  tabs[next]?.focus();tabs[next]?.click();
}
