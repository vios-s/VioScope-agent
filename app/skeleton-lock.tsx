'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ProjectRecord } from '../src/mastra/db/projects';
import { skeletonFields, skeletonDraftSchema } from '../src/mastra/submission/skeleton';
import { latestSkeletonDecisions, type SkeletonRecord } from '../src/mastra/submission/skeleton-record';
import { checklistDraftKey, useChecklistDraft } from './checklist-drafts';
import { requestJson } from './client-request';
import { Check, ChevronDown, Search } from 'lucide-react';

type Summary = Pick<SkeletonRecord, 'id' | 'projectId' | 'createdAt' | 'revision' | 'projectSnapshot' | 'decisions'> & { verdict: string };
type Payload = { projects: ProjectRecord[]; reviews: Summary[]; viewer: { username: string; manager: boolean; administrator: boolean } };

function ProjectContext({ project }: { project: SkeletonRecord['projectSnapshot'] }) {
  return <dl className="skeleton-project-context">
    <div><dt>Project owner</dt><dd>@{project.ownerUsername}</dd></div>
    <div><dt>PI</dt><dd>{project.piUsername ? `@${project.piUsername}` : 'Not assigned'}</dd></div>
    <div><dt>PDRA reviewer</dt><dd>{project.pdraUsername ? `@${project.pdraUsername}` : 'Not assigned'}</dd></div>
    <div><dt>Collaborators</dt><dd>{project.collaborators.join(', ') || 'None recorded'}</dd></div>
    <div><dt>Target venue</dt><dd>{project.venue || 'Not set'}</dd></div>
    <div><dt>Submission deadline</dt><dd>{project.submissionDeadline || 'Not set'}</dd></div>
  </dl>;
}

export function SkeletonLock({ userId }: { userId: string }) {
  const key = (name: string) => checklistDraftKey(userId, 'skeleton:' + name);
  const [data, setData] = useState<Payload | null>(null);
  const [projectId, setProjectId] = useChecklistDraft(key('project'), '');
  const [view, setView] = useChecklistDraft<'projects' | 'pdra' | 'pi'>(key('view'), 'projects');
  const [selectedId, setSelectedId] = useChecklistDraft(key('review'), '');
  const [selected, setSelected] = useState<SkeletonRecord | null>(null);
  const [draft, setDraft] = useChecklistDraft(key('blocks'), skeletonDraftSchema.parse({}));
  const [mode, setMode] = useChecklistDraft(key('mode'), 'blocks');
  const [text, setText] = useChecklistDraft(key('text'), '');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  async function refresh() {
    const payload = await requestJson<Payload>('/api/skeleton-lock', 'Could not load project checks.');
    setData(payload); return payload;
  }
  useEffect(() => { let active = true; void requestJson<Payload>('/api/skeleton-lock', 'Could not load project checks.').then(payload => { if (active) setData(payload); }).catch(caught => { if (active) setError(caught.message); }); return () => { active = false; }; }, []);
  useEffect(() => {
    if (!data || !selectedId || !data.reviews.some(review => review.id === selectedId)) return;
    let active = true;
    void requestJson<{ review: SkeletonRecord }>(`/api/skeleton-lock/${selectedId}`, 'Could not restore saved review.')
      .then(payload => { if (active) setSelected(payload.review); })
      .catch(caught => { if (active) setError(caught.message); });
    return () => { active = false; };
  }, [selectedId, data]);
  const project = data?.projects.find(item => item.id === projectId);
  const selectedProject = data?.projects.find(item => item.id === selected?.projectId);
  const pdraAvailable = data?.viewer.administrator || data?.projects.some(item => item.pdraUsername === data.viewer.username);
  const visible = (data?.reviews || []).filter(review => {
    const current = data?.projects.find(item => item.id === review.projectId);
    if (view === 'pdra') return data?.viewer.administrator || current?.pdraUsername === data?.viewer.username;
    return !projectId || view === 'pi' || review.projectId === projectId;
  });
  function download(format: 'md' | 'json') {
    if (!selected) return;
    const body = format === 'md' ? selected.result.report : JSON.stringify(selected.result, null, 2);
    const url = URL.createObjectURL(new Blob([body], { type: format === 'md' ? 'text/markdown' : 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `skeleton-review-${selected.id}.${format}`; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function openReview(id: string) {
    setSelectedId(id);
    setBusy(true); setError(''); setMessage('');
    try { setSelected((await requestJson<{ review: SkeletonRecord }>(`/api/skeleton-lock/${id}`, 'Could not open review.')).review); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not open review.'); }
    finally { setBusy(false); }
  }
  async function run(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    try {
      const form = new FormData(); form.set('projectId', projectId); form.set('mode', mode);
      if (mode === 'blocks') form.set('blocks', JSON.stringify(draft));
      if (mode === 'paste') form.set('text', text);
      if (mode === 'upload' && file) form.set('file', file);
      const result = await requestJson<{ review: SkeletonRecord }>('/api/skeleton-lock', 'Could not complete the AI check. Your input is retained.', { method: 'POST', body: form });
      setSelectedId(result.review.id); setSelected(result.review); await refresh(); setMessage('AI check saved to the project. PDRA judgment and PI confirmation are pending.');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not run check.'); }
    finally { setBusy(false); }
  }
  async function judge(kind: 'pdra' | 'pi', outcome: string, note: string) {
    if (!selected) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await requestJson<{ review: SkeletonRecord }>(`/api/skeleton-lock/${selected.id}`, 'Could not record judgment.', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, outcome, note, revision: selected.revision, confirmed: true }) });
      setSelectedId(result.review.id); setSelected(result.review); await refresh(); setMessage(kind === 'pdra' ? 'PDRA judgment recorded. PI skeleton checkpoint confirmation remains separate.' : 'PI confirmation recorded. Project stage is unchanged.');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not record judgment.'); }
    finally { setBusy(false); }
  }
  return <section className="skeleton-lock" aria-busy={busy}>
    <h2>Skeleton Lock</h2><p>Draft text is kept in this browser tab until you sign out. Uploaded files must be selected again after refreshing. AI checks and judgments still require explicit submission.</p><p>Project evidence → AI check → PDRA judgment → PI confirmation. Project details are inherited; edit them in Projects.</p>
    {error && <p role="alert" className="ops-error">{error}</p>}{message && <p role="status">{message}</p>}
    {!data ? <p>Loading project checks…</p> : <>
      <div className="ops-button-row" aria-label="Skeleton review views">
        <button type="button" className="ops-secondary" disabled={busy} aria-pressed={view === 'projects'} onClick={() => setView('projects')}>Project checks</button>
        {pdraAvailable && <button type="button" className="ops-secondary" disabled={busy} aria-pressed={view === 'pdra'} onClick={() => setView('pdra')}>PDRA review</button>}
        {data.viewer.manager && <button type="button" className="ops-secondary" disabled={busy} aria-pressed={view === 'pi'} onClick={() => setView('pi')}>PI / Admin overview</button>}
      </div>
      {view === 'projects' && <form onSubmit={run}>
        <fieldset disabled={busy} className="skeleton-input-panel"><legend>Project evidence</legend>
          <ProjectPicker projects={data.projects} value={projectId} onSelect={nextId => { if ((text || file || Object.values(draft).some(value => value.trim())) && !window.confirm('Switch projects and discard the current input? Saved reviews are retained.')) return; setProjectId(nextId); setSelectedId(''); setSelected(null); setDraft(skeletonDraftSchema.parse({})); setText(''); setFile(null); }} />
          {!data.projects.length && <p>Create or join a project before starting Skeleton Lock.</p>}
          {project && <><ProjectContext project={project} />
            {(!project.piUsername || !project.pdraUsername || !project.venue || !project.submissionDeadline) && <p>Some project details are missing. Set the PI, assigned PDRA, target venue and deadline in Projects. Missing values will remain explicit in the AI check.</p>}
            {project.access.canEdit && project.lifecycle === 'active' ? <>
              <label>Input method <select value={mode} onChange={event => setMode(event.target.value)}><option value="blocks">Fill the skeleton sections</option><option value="paste">Paste an outline or draft</option><option value="upload">Upload a draft or deck</option></select></label>
              {mode === 'blocks' && <div className="skeleton-blocks">{skeletonFields.map(field => <div key={field.key}><label htmlFor={`skeleton-input-${field.key}`}>{field.label}</label><p id={`skeleton-hint-${field.key}`}>{field.hint}</p><textarea id={`skeleton-input-${field.key}`} aria-describedby={`skeleton-hint-${field.key}`} rows={4} maxLength={6000} value={draft[field.key]} onChange={event => setDraft(current => ({ ...current, [field.key]: event.target.value }))} /></div>)}</div>}
              {mode === 'paste' && <label>Paste outline <textarea required rows={10} maxLength={55000} value={text} onChange={event => setText(event.target.value)} /></label>}
              {mode === 'upload' && <label>Upload outline <input required type="file" accept=".txt,.md,.markdown,.tex,.latex,.rst,.pptx" onChange={event => setFile(event.target.files?.[0] || null)} /><span>TXT, Markdown, LaTeX, RST or PPTX. Text: 2 MB; decks: 25 MB.</span></label>}
              <p>A new check creates a separate saved review. AI cannot grant approval or move the project to another stage.</p>
              <button type="submit" className="ops-primary">{busy ? 'Checking…' : 'Check skeleton with AI'}</button>
            </> : <p>Project checks are created by the project owner, PI or administrator. You may read reviews permitted by your project access.</p>}
          </>}
        </fieldset>
      </form>}
      <h3>{view === 'pdra' ? 'Assigned PDRA reviews' : view === 'pi' ? 'All project reviews' : 'Project review history'}</h3>
      {!visible.length && <p>No project-bound reviews yet. Earlier unlinked runs are retained separately.</p>}
      <div className="skeleton-review-list">{visible.map(review => {
        const decisions = latestSkeletonDecisions(review.decisions);
        return <button key={review.id} type="button" className="ops-secondary" disabled={busy} onClick={() => void openReview(review.id)}>
          <strong>{review.projectSnapshot.title}</strong><span>@{review.projectSnapshot.ownerUsername} · {new Date(review.createdAt).toLocaleString('en-GB')}</span>
          <span>AI: {review.verdict} · PDRA: {decisions.pdra?.outcome || 'pending'} · PI: {decisions.pi?.outcome || 'pending'}</span>
        </button>;
      })}</div>
      {selected && selectedProject && <section className="skeleton-review-detail">
        <h3>{selected.projectSnapshot.title} — saved review</h3><p>AI evidence and inherited details below are the saved snapshot. Judgment requires the latest review and unchanged project details.</p>
        <ProjectContext project={selected.projectSnapshot} />
        <div className="ops-button-row"><button type="button" className="ops-secondary" onClick={() => download('md')}>Download AI report (MD)</button><button type="button" className="ops-secondary" onClick={() => download('json')}>Download AI report (JSON)</button></div>
        <h4>AI recommendation: {selected.result.structured.verdict}</h4><p>{selected.result.structured.summary}</p>
        <div className="skeleton-review-table"><table><thead><tr><th>Area</th><th>Status</th><th>Evidence</th><th>Gap / next action</th></tr></thead><tbody>{selected.result.structured.findings.map((item,index) => <tr key={index}><td>{item.area}</td><td>{item.status}</td><td>{item.evidence.join(', ')}</td><td>{item.gap}<p>{item.requiredAction}</p></td></tr>)}</tbody></table></div>
        <details><summary>Source evidence with line numbers</summary><pre>{selected.draftText.split('\n').map((line,index) => `${index + 1}: ${line}`).join('\n')}</pre></details>
        <details><summary>Complete AI report</summary><pre>{selected.result.report}</pre></details>
        <p>PDRA: {latestSkeletonDecisions(selected.decisions).pdra?.outcome || 'pending'} · PI: {latestSkeletonDecisions(selected.decisions).pi?.outcome || 'pending'}</p>
        {(selectedProject.pdraUsername === data.viewer.username || data.viewer.administrator) && <JudgmentForm key={`pdra-${selected.id}-${selected.revision}`} kind="pdra" busy={busy} onSave={judge} />}
        {data.viewer.manager && <JudgmentForm key={`pi-${selected.id}-${selected.revision}`} kind="pi" busy={busy} onSave={judge} />}
        {selectedProject.access.canEdit && <SkeletonFollowUp key={selected.id} review={selected} owner={selectedProject.ownerUsername} />}
        <h4>Judgment history</h4>{!selected.decisions.length && <p>No human judgment recorded.</p>}
        <ol>{selected.decisions.map((decision,index) => <li key={index}><strong>{decision.kind.toUpperCase()}: {decision.outcome}</strong> · @{decision.by} · {decision.at}<p>{decision.note}</p></li>)}</ol>
      </section>}
    </>}
  </section>;
}
function JudgmentForm({ kind, busy, onSave }: { kind: 'pdra' | 'pi'; busy: boolean; onSave: (kind: 'pdra' | 'pi', outcome: string, note: string) => Promise<void> }) {
  const [outcome, setOutcome] = useState(kind === 'pdra' ? 'revise' : 'needs_revision'); const [note, setNote] = useState(''); const [confirmed, setConfirmed] = useState(false);
  return <form onSubmit={event => { event.preventDefault(); void onSave(kind, outcome, note); }}><fieldset disabled={busy}>
    <legend>{kind === 'pdra' ? 'PDRA judgment' : 'PI skeleton checkpoint confirmation'}</legend>
    <label>Judgment <select value={outcome} onChange={event => { setOutcome(event.target.value); setConfirmed(false); }}>{(kind === 'pdra' ? [['revise','Revise before locking'],['conditional','Conditional — actions required'],['locked','Ready to lock']] : [['needs_revision','Needs revision'],['approved','Approve skeleton lock']]).map(([value,label]) => <option value={value} key={value}>{label}</option>)}</select></label>
    <label>Reason, evidence and required actions <textarea required rows={4} maxLength={4000} value={note} onChange={event => { setNote(event.target.value); setConfirmed(false); }} /></label>
    <label className="skeleton-confirm"><input type="checkbox" required checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />I have reviewed the source evidence and AI advice and confirm this is my human judgment.</label>
    <button type="submit" className="ops-primary" disabled={!confirmed}>{kind === 'pdra' ? 'Record PDRA judgment' : 'Record PI confirmation'}</button>
  </fieldset></form>;
}

function ProjectPicker({ projects, value, onSelect }: { projects: ProjectRecord[]; value: string; onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (open) searchRef.current?.focus(); }, [open]);
  const selected = projects.find(project => project.id === value);
  const matches = projects.filter(project => `${project.title} ${project.ownerUsername}`.toLowerCase().includes(query.trim().toLowerCase()));
  function close() { setOpen(false); triggerRef.current?.focus(); }
  return <div className="skeleton-project-picker" onKeyDown={event => { if (event.key === 'Escape' && open) { event.preventDefault(); close(); } }}>
    <span id="skeleton-project-label">Existing project</span>
    <button ref={triggerRef} type="button" className="skeleton-project-trigger" aria-labelledby="skeleton-project-label skeleton-project-value" aria-expanded={open} aria-controls="skeleton-project-options" onClick={() => { setQuery(''); setOpen(current => !current); }}>
      <span className="skeleton-project-identity"><span id="skeleton-project-value">{selected?.title || 'Choose a project'}</span>{selected && <span className="skeleton-project-owner">@{selected.ownerUsername}</span>}</span><ChevronDown aria-hidden="true" className={open ? 'is-open' : ''} />
    </button>
    {open && <div id="skeleton-project-options" className="skeleton-project-options">
      <label className="skeleton-project-search"><Search aria-hidden="true" /><input aria-label="Search projects" ref={searchRef} type="search" value={query} placeholder="Search by title or owner" onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') event.preventDefault(); }} /></label>
      <p className="skeleton-project-count" role="status">{matches.length} projects found.</p>
      <ul>{matches.map(project => <li key={project.id}><button type="button" className="skeleton-project-option" aria-pressed={value === project.id} onClick={() => { onSelect(project.id); close(); }}><span className="skeleton-project-identity"><strong>{project.title}</strong><span className="skeleton-project-owner">@{project.ownerUsername}{project.lifecycle !== 'active' ? ` · ${project.lifecycle}` : ''}</span></span>{value === project.id && <Check aria-hidden="true" />}</button></li>)}</ul>
      {!matches.length && <p>No matching projects.</p>}
    </div>}
  </div>;
}

function SkeletonFollowUp({review,owner}:{review:SkeletonRecord;owner:string}) {
 const [busy,setBusy]=useState(false),[status,setStatus]=useState(''),[error,setError]=useState('');
 async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();const form=event.currentTarget;const data=new FormData(form);setBusy(true);setError('');setStatus('');try{
  await requestJson(`/api/projects/${review.projectId}/workflow`,'Could not create follow-up task.',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation:'task',confirmed:true,task:String(data.get('task')),owner:String(data.get('owner')),dueDate:data.get('dueDate')||null,priority:data.get('priority'),sourceKind:'review',sourceId:review.id})});setStatus('Follow-up task added to the project.');form.reset();
 }catch(error){setError(error instanceof Error?error.message:'Could not create task.');}finally{setBusy(false);}}
 return <details><summary>Create a project follow-up task</summary><p>This task links to this saved AI review. Review the suggested action before creating it.</p><form onSubmit={submit}><fieldset disabled={busy}>
  <label>Follow-up action<textarea name="task" required defaultValue={review.result.structured.findings.find(item=>item.requiredAction)?.requiredAction||''}/></label>
  <label>Assignee username<input name="owner" defaultValue={owner} required/></label><label>Due date<input name="dueDate" type="date"/></label><label>Priority<select name="priority"><option value="normal">Normal</option><option value="high">High — required before submission clearance</option></select></label>
  <label className="skeleton-confirm"><input type="checkbox" required/>I confirm this action should be added to the project.</label><button type="submit" className="ops-primary">Create follow-up task</button>{status&&<p role="status">{status}</p>}{error&&<p role="alert">{error}</p>}
 </fieldset></form></details>;
}
