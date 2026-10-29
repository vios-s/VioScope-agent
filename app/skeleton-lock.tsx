'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ProjectRecord } from '../src/mastra/db/projects';
import { paperSkeletonRequirements, paperSkeletonStatusLabels, skeletonFields, skeletonDraftSchema } from '../src/mastra/submission/skeleton';
import { latestSkeletonDecisions, legacySkeletonOutcomes, londonToday, skeletonOutcomeLabels, skeletonVerdictLabels, type SkeletonDecision, type SkeletonRecord } from '../src/mastra/submission/skeleton-record';
import type { SubmissionReviewStructured } from '../src/mastra/submission/schema';
import { checklistDraftKey, useChecklistDraft } from './checklist-drafts';
import { requestJson } from './client-request';
import { ConfirmDialog } from './confirm-dialog';
import { ChevronDown, Download, Plus } from 'lucide-react';
import { formatRecordTime } from './idea-pitch-editor';

type Summary = Pick<SkeletonRecord, 'id' | 'projectId' | 'createdAt' | 'revision' | 'projectSnapshot' | 'decisions'> & { verdict: string };
type Payload = { projects: ProjectRecord[]; reviews: Summary[]; viewer: { username: string; manager: boolean; administrator: boolean } };
type Show = 'all' | 'pdra' | 'pi';

const addDays = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const formatDay = (day: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`));
const formatDeadline = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) ? formatDay(value) : value;
const stageGateReason = (stage: number) => `Opens at stage 4 · now stage ${stage}`;
const verdictShort: Record<string, string> = { CLEARED: 'Cleared', CONDITIONAL: 'Conditional', SLIDE: 'Slide', locked: 'Ready to lock', conditional: 'Conditional', revise: 'Revise' };
const verdictTone: Record<string, string> = { CLEARED: 'ok', CONDITIONAL: 'warn', SLIDE: 'danger', locked: 'ok', conditional: 'warn', revise: 'warn' };
const findingTone: Record<string, string> = { pass: 'ok', partial: 'warn', conditional: 'warn', fail: 'danger', missing: 'danger' };
const paperTone: Record<string, string> = { met: 'ok', partly: 'warn', missing: 'danger', unknown: 'muted' };
const showLabels: Record<Show, string> = { all: 'All checks I can see', pdra: 'Awaiting my PDRA judgment', pi: 'Awaiting PI confirmation' };

/** Dot + word for a project's latest check. The human state leads; AI advice alone never reads as a verdict. */
function checkState(review?: Summary): { tone: string; label: string } {
  if (!review) return { tone: 'muted', label: 'No check yet' };
  const { pdra, pi } = latestSkeletonDecisions(review.decisions);
  if (pi) return pi.outcome === 'approved' ? { tone: 'ok', label: `${pdra ? `${verdictShort[pdra.outcome] || pdra.outcome} · ` : ''}PI confirmed` } : { tone: 'danger', label: 'Returned for revision' };
  if (pdra) return { tone: verdictTone[pdra.outcome] || 'muted', label: `${verdictShort[pdra.outcome] || pdra.outcome} · awaiting PI` };
  return { tone: 'muted', label: 'Awaiting PDRA judgment' };
}

/** Section text of a check made from the sections form; null for a pasted or uploaded document. */
function savedSections(draftText: string) {
  const parts = draftText.slice(draftText.indexOf('\n\n') + 2).split(/^## (.+)$/m);
  const sections = new Map<string, string>();
  for (let index = 1; index < parts.length; index += 2) sections.set(parts[index].trim(), parts[index + 1].trim());
  if (!skeletonFields.every(field => sections.has(field.label))) return null;
  return skeletonFields.map(field => ({ ...field, text: sections.get(field.label) === '[Not provided]' ? '' : sections.get(field.label)! }));
}

export function SkeletonLock({ userId }: { userId: string }) {
  const key = (name: string) => checklistDraftKey(userId, 'skeleton:' + name);
  const formId = 'skeleton-check-form';
  const [data, setData] = useState<Payload | null>(null);
  const [projectId, setProjectId] = useChecklistDraft(key('project'), '');
  const [showChoice, setShow] = useChecklistDraft<Show>(key('show'), 'all');
  const [selectedId, setSelectedId] = useChecklistDraft(key('review'), '');
  const [selected, setSelected] = useState<SkeletonRecord | null>(null);
  const [draft, setDraft] = useChecklistDraft(key('blocks'), skeletonDraftSchema.parse({}));
  const [mode, setMode] = useChecklistDraft(key('mode'), 'blocks');
  const [text, setText] = useChecklistDraft(key('text'), '');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingProjectId, setPendingProjectId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');
  const [listOpen, setListOpen] = useState(false);
  const [reportFormat, setReportFormat] = useState<'md' | 'json'>('md');
  const searchRef = useRef<HTMLInputElement>(null);
  const recordRef = useRef<HTMLDivElement>(null);
  async function refresh() {
    const payload = await requestJson<Payload>('/api/skeleton-lock', 'Could not load project checks.');
    setData(payload); return payload;
  }
  useEffect(() => { let active = true; void requestJson<Payload>('/api/skeleton-lock', 'Could not load project checks.').then(payload => { if (active) setData(payload); }).catch(caught => { if (active) setError(caught.message); }); return () => { active = false; }; }, []);
  useEffect(() => {
    if (!data || !selectedId || selected?.id === selectedId || !data.reviews.some(review => review.id === selectedId && review.projectId === projectId)) return;
    let active = true;
    setBusy(true);
    void requestJson<{ review: SkeletonRecord }>(`/api/skeleton-lock/${selectedId}`, 'Could not open the saved check.')
      .then(payload => { if (active) setSelected(payload.review); })
      .catch(caught => { if (active) setError(caught.message); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [selectedId, data]);
  const viewer = data?.viewer.username;
  const project = data?.projects.find(item => item.id === projectId);
  const byProject = new Map<string, Summary[]>();
  for (const review of data?.reviews || []) byProject.set(review.projectId, [...(byProject.get(review.projectId) || []), review]);
  const projectReviews = byProject.get(projectId) || [];
  const checkNumber = (review: Summary | SkeletonRecord) => { const list = byProject.get(review.projectId) || []; return list.length - list.findIndex(item => item.id === review.id); };
  const pdraAvailable = Boolean(data?.viewer.administrator || data?.projects.some(item => item.pdraUsername === viewer));
  const show: Show = (showChoice === 'pdra' && !pdraAvailable) || (showChoice === 'pi' && !data?.viewer.manager) ? 'all' : showChoice;
  const showOptions = (['all', 'pdra', 'pi'] as const).filter(value => value === 'all' || (value === 'pdra' ? pdraAvailable : data?.viewer.manager));
  const awaiting = (item: ProjectRecord) => {
    const latest = byProject.get(item.id)?.[0];
    if (!latest) return false;
    const decisions = latestSkeletonDecisions(latest.decisions);
    return show === 'pdra' ? !decisions.pdra && (data?.viewer.administrator || item.pdraUsername === viewer) : !decisions.pi;
  };
  const query = search.trim().toLowerCase();
  // The open project stays listed after its judgment is recorded, so the record never loses its list entry.
  const matching = (data?.projects || []).filter(item => `${item.title} @${item.ownerUsername}`.toLowerCase().includes(query) && (show === 'all' || awaiting(item) || item.id === projectId));
  const groups = [
    { label: 'Stage 4 projects', items: matching.filter(item => item.stage === 4), gated: false },
    { label: 'Checks at other stages', items: matching.filter(item => item.stage !== 4 && byProject.has(item.id)), gated: false },
    { label: 'Not at stage 4', items: matching.filter(item => item.stage !== 4 && !byProject.has(item.id)), gated: true },
  ];
  const saved = selected && selected.projectId === projectId && selected.id === selectedId ? selected : null;
  const loadingCheck = Boolean(!saved && selectedId && projectReviews.some(review => review.id === selectedId));
  const canCompose = Boolean(project && project.stage === 4 && project.access.canEdit && project.lifecycle === 'active');
  const hasInput = Boolean(text.trim() || file || Object.values(draft).some(value => value.trim()));
  // Reviews saved before the rename carry the generic B2 report heading.
  const reportText = saved?.result.report.replace(/^# VIOS B2 Pre-Submission Review/, '# VIOS Skeleton Lock review') || '';
  function download() {
    if (!saved) return;
    const body = reportFormat === 'md' ? reportText : JSON.stringify(saved.result, null, 2);
    const url = URL.createObjectURL(new Blob([body], { type: reportFormat === 'md' ? 'text/markdown' : 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `skeleton-review-${saved.id}.${reportFormat}`; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  // The effect above loads the chosen check.
  function openReview(id: string) { setSelectedId(id); setError(''); setMessage(''); }
  function newCheck() {
    if (canCompose) { setSelectedId(''); setSelected(null); setMessage(''); return; }
    // Without an open stage-4 project there is nothing to start: send the person to the project list.
    setListOpen(true); window.requestAnimationFrame(() => searchRef.current?.focus());
  }
  function selectProject(id: string) {
    setListOpen(false);
    if (id === projectId) return;
    if (hasInput) setPendingProjectId(id); else switchProject(id);
  }
  // Selecting a project shows its latest check, or the empty sections for a new one.
  function switchProject(id: string) {
    setPendingProjectId(null); setProjectId(id); setDraft(skeletonDraftSchema.parse({})); setText(''); setFile(null); setError(''); setMessage('');
    const latest = byProject.get(id)?.[0];
    if (latest) openReview(latest.id); else { setSelectedId(''); setSelected(null); }
    if ((recordRef.current?.getBoundingClientRect().top ?? 0) < 0) recordRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
  async function judge(kind: 'pdra' | 'pi', outcome: string, note: string, override: boolean, reevaluateOn?: string) {
    if (!saved) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await requestJson<{ review: SkeletonRecord }>(`/api/skeleton-lock/${saved.id}`, 'Could not record judgment.', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, outcome, note, revision: saved.revision, confirmed: true, ...(override ? { override: true } : {}), ...(reevaluateOn ? { reevaluateOn } : {}) }) });
      setSelectedId(result.review.id); setSelected(result.review); await refresh(); setMessage(kind === 'pdra' ? 'PDRA judgment recorded. PI skeleton checkpoint confirmation remains separate.' : 'PI confirmation recorded. Project stage is unchanged.');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not record judgment.'); }
    finally { setBusy(false); }
  }
  const latest = saved ? latestSkeletonDecisions(saved.decisions) : null;
  // Mirrors the server: never the project owner, never both steps by one person; administrators act only as a labelled override.
  const mayJudge = (kind: 'pdra' | 'pi') => {
    if (!saved || !project || !latest || project.ownerUsername === viewer) return null;
    if (kind === 'pdra' ? saved.decisions.some(item => item.kind === 'pi' && item.by === viewer) : latest.pdra?.by === viewer) return null;
    if ((kind === 'pdra' ? project.pdraUsername : project.piUsername) === viewer) return 'assigned';
    return data?.viewer.administrator ? 'override' : null;
  };
  // A saved check shows the details recorded with it; a new check shows the live project details.
  const people = saved?.projectSnapshot || project;
  const sections = saved ? savedSections(saved.draftText) : null;
  const verdict = saved?.result.structured.verdict || '';
  return <section className="checklist-panel skeleton-lock" aria-busy={busy}>
    {error && <p role="alert" className="ops-notice error checklist-page-notice">{error}</p>}
    {message && <p role="status" className="form-message checklist-page-notice">{message}</p>}
    {!data ? <p role="status" className="checklist-list-note">Loading project checks…</p> : <div className="checklist-workspace">
      <aside className="checklist-list" aria-label="Skeleton reviews">
        <button className="ops-secondary checklist-new" type="button" disabled={busy} onClick={newCheck}><Plus aria-hidden="true" />New check</button>
        <button type="button" className="checklist-list-toggle" aria-expanded={listOpen} aria-controls="skeleton-list-body" onClick={() => setListOpen(open => !open)}>
          <span>{listOpen ? 'Hide projects' : `Projects (${data.projects.length})`}</span>
          {!listOpen && <small>{project ? `Open: ${project.title}` : 'Choose a project'}</small>}
          <ChevronDown aria-hidden="true" />
        </button>
        <div id="skeleton-list-body" className="checklist-list-body" data-open={listOpen}>
          {data.projects.length > 0 && <div className="checklist-list-filters">
            <label>Find a project<input ref={searchRef} type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Project or @owner" /></label>
            {showOptions.length > 1 && <label>Show<select value={show} onChange={event => setShow(event.target.value as Show)}>{showOptions.map(value => <option key={value} value={value}>{showLabels[value]}</option>)}</select></label>}
          </div>}
          <p className="vs-sr-only" role="status">{matching.length} projects found.</p>
          {!data.projects.length && <p className="checklist-list-note">Create or join a project before starting Skeleton Lock.</p>}
          {data.projects.length > 0 && !matching.length && <p className="checklist-list-note" role="status">{show === 'all' ? 'No projects match this search.' : 'Nothing is awaiting you here.'}</p>}
          {groups.map(group => group.items.length > 0 && <div className="checklist-list-group" key={group.label}>
            <h2 className="vs-caps">{group.label}</h2>
            <ul>{group.items.map(item => {
              const reviews = byProject.get(item.id) || [];
              const state = checkState(reviews[0]);
              return <li key={item.id}>
                <button type="button" data-project-id={item.id} className={`checklist-list-item${item.id === projectId ? ' active' : ''}`} aria-current={item.id === projectId ? 'true' : undefined} disabled={busy || group.gated} onClick={() => selectProject(item.id)}>
                  <span>{item.title}</span>
                  <small>{item.ownerUsername !== viewer && <>@{item.ownerUsername} · </>}{group.gated ? stageGateReason(item.stage) : <><span className={`checklist-status is-${state.tone}`}>{state.label}</span>{reviews[0] && <> · <span className="vs-mono">Check {reviews.length}</span> · {formatRecordTime(reviews[0].createdAt, false)}</>}</>}{item.lifecycle !== 'active' ? ` · ${item.lifecycle}` : ''}</small>
                </button>
              </li>;
            })}</ul>
          </div>)}
        </div>
        <p className="checklist-list-note">Project details are inherited; edit them in Projects. Section text is kept in this browser tab until you sign out.</p>
      </aside>
      <div ref={recordRef} className="checklist-record-host">
        {!project ? <div className="ops-empty checklist-empty"><strong>Choose a project</strong><span>Skeleton Lock checks open for projects at stage 4 (Pre-Submission). Earlier checks stay readable at any stage.</span></div>
        : <div className="checklist-record skeleton-record">
          <div className="checklist-record-main">
            <div className="checklist-record-head">
              <span className="checklist-record-label">Project · Stage {project.stage}{project.stage === 4 ? ' Pre-Submission' : ''}</span>
              <h2 className="checklist-record-title">{project.title}</h2>
              <div className="checklist-record-meta">
                <span className="vs-mono">{saved ? `Check ${checkNumber(saved)} · saved ${formatRecordTime(saved.createdAt)} · revision ${saved.revision}` : 'New check · not run yet'}</span>
                {people && <span>Lead @{people.ownerUsername} · PDRA {people.pdraUsername ? `@${people.pdraUsername}` : 'not assigned'} · PI {people.piUsername ? `@${people.piUsername}` : 'not assigned'}</span>}
                {people && <span><span>{people.venue || 'Venue not set'}</span> · due <span className="vs-mono">{people.submissionDeadline ? formatDeadline(people.submissionDeadline) : 'not set'}</span></span>}
                {projectReviews.length > 0 && <label className="checklist-inline-field">Check<select value={saved || loadingCheck ? selectedId : ''} disabled={busy} onChange={event => { if (event.target.value) openReview(event.target.value); else newCheck(); }}>
                  {canCompose ? <option value="">New check</option> : !saved && <option value="" disabled>Choose a saved check</option>}
                  {projectReviews.map((review, index) => <option key={review.id} value={review.id}>Check {projectReviews.length - index} · {formatRecordTime(review.createdAt)}</option>)}
                </select></label>}
              </div>
              {saved && <p className="checklist-hint">Saved snapshot of the evidence and project details. A judgment requires the latest check and unchanged project details.</p>}
            </div>
            {!saved && !loadingCheck && canCompose && (!project.piUsername || !project.pdraUsername || !project.venue || !project.submissionDeadline) && <p className="ops-notice">Some project details are missing. Set the PI, assigned PDRA, target venue and deadline in Projects. Missing values will remain explicit in the AI check.</p>}
            {!saved && !loadingCheck && project.stage !== 4 && <p className="ops-notice" role="status">Skeleton Lock opens at stage 4 (Pre-Submission). This project is currently at stage {project.stage}; update the stage in Projects when it is ready.{projectReviews.length ? ' Earlier checks remain available from the Check list.' : ''}</p>}
            {!saved && !loadingCheck && project.stage === 4 && !canCompose && <p className="ops-notice" role="status">Project checks are created by the project owner, PI or administrator of an active project. You may read checks permitted by your project access.</p>}
            {loadingCheck && <p role="status" className="checklist-hint">Loading the saved check…</p>}
            {!saved && !loadingCheck && canCompose && <form id={formId} onSubmit={run} className="checklist-record-form">
              <details className="checklist-import" open={mode !== 'blocks'}>
                <summary>Start from an existing document</summary>
                <fieldset disabled={busy}><legend className="vs-sr-only">Existing document</legend>
                  <p className="checklist-hint">Paste an outline or upload a draft or deck to check it instead of the sections. The AI reads the document as supplied; nothing is copied into the sections.</p>
                  <label className="checklist-field-narrow">Input method <select value={mode} onChange={event => setMode(event.target.value)}><option value="blocks">Fill the skeleton sections</option><option value="paste">Paste an outline or draft</option><option value="upload">Upload a draft or deck</option></select></label>
                  {mode === 'paste' && <label>Paste outline <textarea required rows={10} maxLength={55000} value={text} onChange={event => setText(event.target.value)} /></label>}
                  {mode === 'upload' && <label>Upload outline <input required type="file" accept=".txt,.md,.markdown,.tex,.latex,.rst,.docx,.pdf,.pptx" onChange={event => setFile(event.target.files?.[0] || null)} /><span className="checklist-hint">TXT, Markdown, LaTeX, RST, DOCX, text-based PDF or PPTX. Text: 2 MB; DOCX and PDF: 5 MB; decks: 25 MB. Check the extracted text in the saved check for missing images or equations.</span></label>}
                </fieldset>
              </details>
              <fieldset disabled={busy} className="checklist-blocks"><legend className="vs-sr-only">Skeleton sections</legend>
                {mode === 'blocks' ? skeletonFields.map((field, index) => <div key={field.key} className="checklist-block">
                  <div className="checklist-block-head"><span className="checklist-block-num" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span><label htmlFor={`skeleton-input-${field.key}`}>{field.label}</label>{!draft[field.key].trim() && <span className="checklist-empty-chip">Empty</span>}</div>
                  <textarea id={`skeleton-input-${field.key}`} placeholder={field.hint} rows={4} maxLength={6000} value={draft[field.key]} onChange={event => setDraft(current => ({ ...current, [field.key]: event.target.value }))} />
                </div>) : <p className="checklist-hint">The AI check will read the {mode === 'paste' ? 'pasted outline' : 'uploaded document'}. Choose “Fill the skeleton sections” under Start from an existing document to use the sections instead.</p>}
              </fieldset>
            </form>}
            {saved && <>
              <div className="checklist-blocks">
                {sections ? sections.map((field, index) => <div key={field.key} className="checklist-block">
                  <div className="checklist-block-head"><span className="checklist-block-num" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span><label htmlFor={`skeleton-saved-${field.key}`}>{field.label}</label>{!field.text && <span className="checklist-empty-chip">Not provided</span>}</div>
                  <textarea id={`skeleton-saved-${field.key}`} readOnly rows={2} value={field.text} />
                </div>) : <div className="checklist-block"><div className="checklist-block-head"><span className="checklist-block-num" aria-hidden="true">01</span><label htmlFor="skeleton-saved-document">Submitted document</label></div>
                  <textarea id="skeleton-saved-document" readOnly rows={8} value={saved.draftText.slice(saved.draftText.indexOf('\n\n') + 2)} /></div>}
              </div>
              <details className="checklist-import"><summary>Source evidence with line numbers</summary><pre className="checklist-source-text">{saved.draftText.split('\n').map((line, index) => `${index + 1}: ${line}`).join('\n')}</pre></details>
              {project.access.canEdit && <SkeletonFollowUp key={saved.id} review={saved} owner={project.ownerUsername} />}
            </>}
            {(saved || (canCompose && !loadingCheck)) && <div className="checklist-action-bar">
              <span className={`checklist-bar-state ${saved ? '' : hasInput ? 'is-dirty' : 'is-idle'}`}>{saved ? 'Saved check · read only' : hasInput ? 'Draft kept in this browser tab · not checked yet' : 'No section text yet'}</span>
              {saved && <div className="checklist-export" role="group" aria-label="Download AI report">
                <label>Report format <select value={reportFormat} onChange={event => setReportFormat(event.target.value as 'md' | 'json')}><option value="md">Markdown (.md)</option><option value="json">JSON (.json)</option></select></label>
                <button type="button" className="ops-secondary" onClick={download}><Download aria-hidden="true" />Download report</button>
              </div>}
            </div>}
          </div>
          <aside className="checklist-rail" aria-label="Advice and decisions">
            <section className="checklist-advice" aria-labelledby="skeleton-advice-heading">
              <div className="checklist-advice-head"><h3 id="skeleton-advice-heading">Agent advice</h3><span className="checklist-advisory-tag">Advisory</span></div>
              {saved ? <>
                <span className={`checklist-advice-status is-${verdictTone[verdict] || 'muted'}`}>Suggested verdict: {skeletonVerdictLabels[verdict] || verdict}</span>
                <p className="checklist-advice-meta">From <span className="vs-mono">Check {checkNumber(saved)}</span> · <span className="vs-mono">{formatRecordTime(saved.createdAt)}</span>. Advice only; the PDRA records the verdict.</p>
                <p>{saved.result.structured.summary}</p>
                {saved.result.structured.paperSkeleton && <PaperSkeletonChecklist items={saved.result.structured.paperSkeleton} />}
                {saved.result.structured.findings.length > 0 && <section className="skeleton-findings" aria-labelledby="skeleton-findings-heading">
                  <h4 id="skeleton-findings-heading">Findings</h4>
                  <ul className="checklist-advice-list">{saved.result.structured.findings.map((item, index) => <li key={index}>
                    <span className="checklist-advice-row"><strong>{item.area}</strong><span className={`checklist-advice-status is-${findingTone[item.status] || 'muted'}`}>{item.status.charAt(0).toUpperCase() + item.status.slice(1)}</span></span>
                    <p>{item.gap}</p>
                    {item.requiredAction && <p className="checklist-advice-improve">Action: {item.requiredAction}</p>}
                    {item.evidence.length > 0 && <small className="checklist-advice-meta">Evidence: <span className="vs-mono">{item.evidence.join(', ')}</span></small>}
                  </li>)}</ul>
                </section>}
                <details><summary>Complete AI report</summary><pre className="checklist-source-text">{reportText}</pre></details>
                {canCompose && <button type="button" className="ops-secondary checklist-advice-run" disabled={busy} onClick={newCheck}>Start a new check</button>}
              </> : <>
                <p>{loadingCheck ? 'Loading the saved check…' : canCompose ? 'No AI check for this draft yet.' : 'No AI check to show.'}</p>
                <p className="checklist-advice-meta">The agent reads the skeleton against the VIOS Skeleton Lock checklist and the Paper Skeleton minimum content. It cannot approve, decide or change a stage.</p>
                {canCompose && !loadingCheck && <button type="submit" form={formId} className="ops-secondary checklist-advice-run" disabled={busy}>{busy ? 'Checking…' : 'Check skeleton with AI'}</button>}
                {canCompose && !loadingCheck && <p className="checklist-advice-meta">Each check is saved separately to the project.</p>}
              </>}
            </section>
            <section className="checklist-step" aria-labelledby="skeleton-pdra-heading">
              <h3 id="skeleton-pdra-heading">1 · PDRA judgment</h3>
              <p>CLEARED, CONDITIONAL (with a re-evaluation date) or SLIDE to the next submission cycle.</p>
              {latest?.pdra ? <DecisionRecord decision={latest.pdra} /> : <p className="checklist-step-state">{saved ? 'Awaiting' : 'Recorded after an AI check by'} {people?.pdraUsername ? `@${people.pdraUsername}` : 'an assigned PDRA'}.</p>}
              {saved && mayJudge('pdra') && <JudgmentForm key={`pdra-${saved.id}-${saved.revision}`} kind="pdra" override={mayJudge('pdra') === 'override'} busy={busy} onSave={judge} />}
            </section>
            <section className="checklist-step" aria-labelledby="skeleton-pi-heading">
              <h3 id="skeleton-pi-heading">2 · PI confirmation</h3>
              {latest?.pi ? <DecisionRecord decision={latest.pi} /> : <p className="checklist-step-state">Awaiting {people?.piUsername ? `@${people.piUsername}` : 'the project PI'}. Only the project PI can confirm; an administrator may record an explicit administrator override. The project owner and the PDRA who judged this check cannot confirm it.</p>}
              {saved && mayJudge('pi') && <JudgmentForm key={`pi-${saved.id}-${saved.revision}`} kind="pi" override={mayJudge('pi') === 'override'} busy={busy} onSave={judge} />}
            </section>
            {saved && <section className="checklist-step skeleton-judgment-history" aria-labelledby="skeleton-history-heading">
              <h3 id="skeleton-history-heading">Judgment history</h3>{!saved.decisions.length && <p>No human judgment recorded.</p>}
              <ol>{saved.decisions.map((decision, index) => <li key={index}><strong>{decision.kind === 'pdra' ? 'PDRA judgment' : 'PI confirmation'}: {skeletonOutcomeLabels[decision.outcome] || decision.outcome}</strong>{decision.reevaluateOn ? <> · Re-evaluate on <span className="vs-mono">{formatDay(decision.reevaluateOn)}</span></> : ''}{decision.kind === 'pdra' && legacySkeletonOutcomes.has(decision.outcome) ? ' · Earlier verdict scale' : ''}{decision.override ? ' · Administrator override' : ''} · @{decision.by} · <span className="vs-mono">{formatRecordTime(decision.at)}</span><p>{decision.note}</p></li>)}</ol>
            </section>}
          </aside>
        </div>}
      </div>
    </div>}
    <ConfirmDialog id="skeleton-switch-confirm" open={pendingProjectId !== null} tone="default" title="Switch project?"
      message="The current Skeleton Lock input will be discarded. Saved checks are retained."
      confirmLabel="Discard and switch" cancelLabel="Keep editing" onCancel={() => setPendingProjectId(null)} onConfirm={() => switchProject(pendingProjectId ?? '')} />
  </section>;
}
function DecisionRecord({ decision }: { decision: SkeletonDecision }) {
  return <div className="checklist-step-state skeleton-decision-record">
    <span className="skeleton-decision-meta">{decision.kind === 'pdra' ? 'PDRA judgment' : 'PI confirmation'}{decision.kind === 'pdra' && legacySkeletonOutcomes.has(decision.outcome) ? ' · Earlier verdict scale' : ''}{decision.override ? ' · Administrator override' : ''} · @{decision.by} · <span className="vs-mono">{formatRecordTime(decision.at)}</span></span>
    <span><strong>{skeletonOutcomeLabels[decision.outcome] || decision.outcome}.</strong>{decision.reevaluateOn && <> Re-evaluate on <span className="vs-mono">{formatDay(decision.reevaluateOn)}</span>.</>} {decision.note}</span>
  </div>;
}
function JudgmentForm({ kind, override, busy, onSave }: { kind: 'pdra' | 'pi'; override: boolean; busy: boolean; onSave: (kind: 'pdra' | 'pi', outcome: string, note: string, override: boolean, reevaluateOn?: string) => Promise<void> }) {
  const [outcome, setOutcome] = useState(kind === 'pdra' ? '' : 'needs_revision'); const [note, setNote] = useState(''); const [confirmed, setConfirmed] = useState(false);
  const [today] = useState(londonToday); const [reevaluateOn, setReevaluateOn] = useState(() => addDays(today, 3));
  const conditional = kind === 'pdra' && outcome === 'CONDITIONAL';
  return <form className="skeleton-judgment" onSubmit={event => { event.preventDefault(); void onSave(kind, outcome, note, override, conditional ? reevaluateOn : undefined); }}><fieldset disabled={busy}>
    <legend>{override ? 'Administrator override — ' : ''}{kind === 'pdra' ? 'PDRA judgment' : 'PI skeleton checkpoint confirmation'}</legend>
    {override && <p className="checklist-hint">You are not the assigned {kind === 'pdra' ? 'PDRA' : 'project PI'}. This judgment is recorded and shown as an administrator override.</p>}
    <label>Judgment <select required value={outcome} onChange={event => { setOutcome(event.target.value); setConfirmed(false); }}>{kind === 'pdra' && <option value="" disabled>Choose a verdict</option>}{(kind === 'pdra' ? [['CLEARED', skeletonVerdictLabels.CLEARED], ['CONDITIONAL', skeletonVerdictLabels.CONDITIONAL], ['SLIDE', skeletonVerdictLabels.SLIDE]] : [['needs_revision', 'Return for revision'], ['approved', 'Confirm skeleton lock']]).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
    {conditional && <label>Re-evaluation date (Europe/London) <input type="date" required min={addDays(today, 1)} value={reevaluateOn} onChange={event => { setReevaluateOn(event.target.value); setConfirmed(false); }} /><span className="checklist-hint">72-hour sprint on the named gaps, then re-evaluate on this date.</span></label>}
    <label>Reason, evidence and required actions <textarea required rows={4} maxLength={4000} value={note} onChange={event => { setNote(event.target.value); setConfirmed(false); }} /></label>
    <label className="checklist-confirm"><input type="checkbox" required checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />I have reviewed the source evidence and AI advice and confirm this is my human judgment{override ? ', recorded as an administrator override' : ''}.</label>
    <button type="submit" className="ops-primary" disabled={!confirmed}>{kind === 'pdra' ? 'Record PDRA judgment' : 'Record PI confirmation'}</button>
  </fieldset></form>;
}

function SkeletonFollowUp({ review, owner }: { review: SkeletonRecord; owner: string }) {
  const [busy, setBusy] = useState(false), [status, setStatus] = useState(''), [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); setBusy(true); setError(''); setStatus('');
    try {
      await requestJson(`/api/projects/${review.projectId}/workflow`, 'Could not create follow-up task.', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation: 'task', confirmed: true, task: String(data.get('task')), owner: String(data.get('owner')), dueDate: data.get('dueDate') || null, priority: data.get('priority'), sourceKind: 'review', sourceId: review.id }) });
      setStatus('Follow-up task added to the project.'); form.reset();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not create task.'); } finally { setBusy(false); }
  }
  return <details className="checklist-import"><summary>Create a project follow-up task</summary><form onSubmit={submit}><fieldset disabled={busy}><legend className="vs-sr-only">Project follow-up task</legend>
    <p className="checklist-hint">This task links to this saved check. Review the suggested action before creating it.</p>
    <label>Follow-up action<textarea name="task" required defaultValue={review.result.structured.findings.find(item => item.requiredAction)?.requiredAction || ''} /></label>
    <div className="checklist-field-grid"><label>Assignee username<input name="owner" defaultValue={owner} required /></label><label>Due date<input name="dueDate" type="date" /></label><label>Priority<select name="priority"><option value="normal">Normal</option><option value="high">High — required before submission clearance</option></select></label></div>
    <label className="checklist-confirm"><input type="checkbox" required />I confirm this action should be added to the project.</label><button type="submit" className="ops-primary">Create follow-up task</button>{status && <p role="status" className="form-message">{status}</p>}{error && <p role="alert" className="ops-notice error">{error}</p>}
  </fieldset></form></details>;
}

function PaperSkeletonChecklist({ items }: { items: NonNullable<SubmissionReviewStructured['paperSkeleton']> }) {
  const groups = [...new Set(paperSkeletonRequirements.map(item => item.group))];
  return <section className="skeleton-paper" aria-labelledby="skeleton-paper-heading">
    <h4 id="skeleton-paper-heading">Paper Skeleton minimum content</h4>
    <p className="checklist-advice-meta">AI reading of the VIOS Paper Skeleton requirements. Measured values are counted by VioScope from the supplied text and may differ from the AI reading.</p>
    {groups.map(group => <div key={group} className="skeleton-paper-group"><h5 className="vs-caps">{group}</h5>
      <ul className="checklist-advice-list">{paperSkeletonRequirements.filter(item => item.group === group).map(requirement => {
        const item = items.find(entry => entry.id === requirement.id);
        if (!item) return null;
        const notFound = item.evidence.trim().toLowerCase() === 'not found';
        return <li key={item.id}>
          <span className="checklist-advice-row"><strong>{requirement.label}</strong><span className={`checklist-advice-status skeleton-paper-status is-${paperTone[item.status] || 'muted'}`}>{paperSkeletonStatusLabels[item.status] || item.status}</span></span>
          {item.measured && <small className="checklist-advice-meta">Measured: <span className="vs-mono">{item.measured}</span></small>}
          <details><summary>Requirement and evidence</summary><p>{requirement.requirement}</p>
            {notFound ? <p className="checklist-advice-meta">Evidence not found.</p> : <blockquote>“{item.evidence}”</blockquote>}
            {!notFound && !item.quoteFound && <p className="checklist-advice-meta">Quote not located in the source text.</p>}
          </details>
        </li>;
      })}</ul>
    </div>)}
  </section>;
}
