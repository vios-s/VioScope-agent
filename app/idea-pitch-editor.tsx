'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Check, Clock, Download, Lock, Trash2, Upload } from 'lucide-react';
import { IdeaPitchSharing } from './idea-pitch-sharing';
import { checklistDraftKey, readChecklistDraft, writeChecklistDraft, removeChecklistDraft } from './checklist-drafts';
import { ApiRequestError, requestJson } from './client-request';
import { ConfirmDialog } from './confirm-dialog';
import { checkIdea, ideaDraftSchema, ideaFields, ideaOutcomeLabels, pitchExportFilename, defaultPitchExportFormat, type PitchExportFormat, type IdeaCheckPayload, type IdeaDecision, type IdeaDraft, type IdeaSource } from '../src/mastra/projects/idea-check';
import { ideaBlockStatusLabels, ideaDiscussantQuestions, ideaDiscussantStatusLabels, isLegacyIdeaReview, type IdeaReview, type SavedIdeaReview } from '../src/mastra/projects/idea-review-schema';
import { formatDayTime } from './format';

export function IdeaPitchEditor({ userId, pitchId, onChanged, onProjectCreated, onDeleted, onStateChanged }: { userId: string; pitchId: string; onChanged: (id: string) => Promise<void>; onProjectCreated: () => Promise<void>; onDeleted: () => Promise<void>; onStateChanged: (state: { dirty: boolean; busy: boolean }) => void }) {
  const prefix = useId();
  const storageKey = checklistDraftKey(userId, 'idea:' + (pitchId || 'new'));
  const restored = useRef(readChecklistDraft<{ id: string; version: number; title: string; draft: IdeaDraft; source: IdeaSource | null; pasted: string } | null>(storageKey, null));
  const [conflictingDraft, setConflictingDraft] = useState<typeof restored.current>(null);
  const resolvedId = useRef(restored.current?.id || pitchId);
  const [title, setTitle] = useState(restored.current?.title || '');
  const [exportFormat, setExportFormat] = useState<PitchExportFormat>('docx');
  const emptyPayload: IdeaCheckPayload = { pitch: { id: '', title: 'New pitch', ownerUsername: '', projectId: null, outcome: null }, current: null, history: [], reviews: [], canEdit: true, canManage: true, collaborators: [] };
  const [data, setData] = useState<IdeaCheckPayload | null>(resolvedId.current ? null : emptyPayload);
  const [draft, setDraft] = useState<IdeaDraft>(() => ideaDraftSchema.parse(restored.current?.draft || {}));
  const [source, setSource] = useState<IdeaSource | null>(restored.current?.source || null);
  const [upload, setUpload] = useState<File | null>(null);
  const [pasted, setPasted] = useState(restored.current?.pasted || '');
  const [preview, setPreview] = useState<{ draft: IdeaDraft; source: IdeaSource; title?: string } | null>(null);
  const [decision, setDecision] = useState<IdeaDecision>({ outcome: 'revise', rationale: '', nextMilestone: '' });
  const [confirmed, setConfirmed] = useState(false);
  const [createConfirmed, setCreateConfirmed] = useState(false);
  const [initialAction, setInitialAction] = useState('');
  const [setup, setSetup] = useState({track:'A',piUsername:'',pdraUsername:'',otherPdras:'',collaborators:''});
  const [actionDueDate, setActionDueDate] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [operationBusy, setBusy] = useState(false);
  const [sharingBusy, setSharingBusy] = useState(false);
  const busy = operationBusy || sharingBusy;
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [reload, setReload] = useState(0);
  const [reloadConfirmOpen, setReloadConfirmOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(() => Boolean(restored.current?.pasted));
  const url = `/api/idea-pitches/${encodeURIComponent(resolvedId.current)}`;
  async function ensurePitch() {
    if (!resolvedId.current) {
      if (!title.trim()) throw new Error('Enter a pitch title before saving.');
      const result = await requestJson<{ id: string }>('/api/idea-pitches', 'Could not create pitch.', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: title.trim() }) });
      resolvedId.current = result.id;
      // List the new record now so it can be picked even if the first save fails.
      await onChanged(result.id).catch(() => undefined);
    }
    return `/api/idea-pitches/${encodeURIComponent(resolvedId.current)}`;
  }
  useEffect(() => {
    let active = true;
    if (!resolvedId.current) return;
    setData(null); setError(''); setStatus('');
    void requestJson<IdeaCheckPayload>(url, 'Could not load idea check.').then((payload) => {
      if (!active) return;
      setData(payload); setExportFormat(defaultPitchExportFormat(payload.current?.source?.name)); setTitle(payload.pitch.title); setDraft(ideaDraftSchema.parse(payload.current?.draft || {}));
      if (payload.current?.draft.track) setSetup(current => ({ ...current, track: payload.current!.draft.track })); setSource(payload.current?.source || null); setPreview(null);
      const cached = restored.current;
      if (cached && payload.canEdit && cached.version === (payload.current?.version || 0)) {
        setTitle(cached.title); setDraft(ideaDraftSchema.parse(cached.draft)); setSource(cached.source); setPasted(cached.pasted);
      } else if (cached) {
        if (payload.canEdit) setConflictingDraft(cached);
        else removeChecklistDraft(storageKey);
        setStatus('A newer saved version or changed access was found. The saved version is shown.');
      }
      restored.current = null;
      setDecision({ outcome: 'revise', rationale: '', nextMilestone: '' }); setConfirmed(false);
    }).catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : 'Could not load.'); });
    return () => { active = false; };
  }, [pitchId, reload]);
  useEffect(() => {
    if (!data?.canEdit || conflictingDraft) return;
    writeChecklistDraft(checklistDraftKey(userId, 'idea:' + (resolvedId.current || 'new')), {
      id: resolvedId.current, version: data.current?.version || 0, title, draft, source, pasted,
    });
    // Keep an unsaved new pitch reachable until the parent selects its saved record.
    if (!pitchId && !data.pitch.id) writeChecklistDraft(storageKey, {
      id: resolvedId.current, version: data.current?.version || 0, title, draft, source, pasted,
    });
  }, [data, title, draft, source, pasted, userId, pitchId, storageKey, conflictingDraft]);
  async function prepareImport() {
    setBusy(true); setError(''); setPreview(null);
    try {
      // A new pitch is previewed without creating a record; Save creates it, using the suggested title when the title is empty.
      const target = resolvedId.current ? url : '/api/idea-pitches/new';
      const form = new FormData(); if (upload) form.set('file', upload); if (pasted.trim()) form.set('text', pasted);
      setPreview(await requestJson<{ draft: IdeaDraft; source: IdeaSource; title?: string }>(`${target}/import`, 'Could not organise the document.', { method: 'POST', body: form }));
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not import.'); }
    finally { setBusy(false); }
  }
  async function runReview() {
    if (!data?.current) return;
    setBusy(true); setError(''); setStatus('');
    try {
      await requestJson(`${url}/review`, 'Could not review the pitch.', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: data.current.version }) });
      setData(await requestJson<IdeaCheckPayload>(url, 'Review saved, but could not refresh. Reload saved version.'));
      setStatus('AI advice saved. A person must still make the decision.');
    } catch (caught) {
      // Access and stale-version refusals explain themselves; model failures get the generic retry advice.
      setError(caught instanceof ApiRequestError && (caught.status === 403 || caught.status === 409) ? caught.message : 'Could not complete the AI review. Your saved draft is unchanged. Try Check pitch with AI again.');
    }
    finally { setBusy(false); }
  }
  const dirty = Boolean(conflictingDraft) || title !== (data?.pitch.id ? data.pitch.title : '') || JSON.stringify(draft) !== JSON.stringify(data?.current?.draft || ideaDraftSchema.parse({})) || JSON.stringify(source) !== JSON.stringify(data?.current?.source || null);
  useEffect(() => { onStateChanged({ dirty, busy }); }, [dirty, busy, onStateChanged]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  async function downloadPitch() {
    if (!data?.current) return;
    setBusy(true); setError('');
    try {
      const response = await fetch(`${url}/export?format=${exportFormat}&version=${data.current.version}`);
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || 'Could not export this pitch. Try again or choose another format.');
      }
      const blob = await response.blob(); const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a'); link.href = objectUrl; link.download = pitchExportFilename(data.pitch.title, data.current.version, exportFormat);
      document.body.append(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
      setStatus('Approved pitch downloaded.');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not download.'); }
    finally { setBusy(false); }
  }
  async function removePitch() {
    if (!data || !resolvedId.current) return;
    setDeleteOpen(false); setBusy(true); setError('');
    try {
      await requestJson(url, 'Could not delete pitch.', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: data.current?.version || 0, confirmed: true }) });
      await onDeleted();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not delete pitch.'); }
    finally { setBusy(false); }
  }
  const checks = checkIdea(draft);
  const missing = checks.filter((item) => !item.present);
  async function save(operation: 'save' | 'decide' | 'create_project') {
    if (!data || conflictingDraft) return;
    if (operation === 'save' && !title.trim()) { setError('Enter a pitch title before saving.'); return; }
    setBusy(true); setError(''); setStatus('');
    try {
      const target = await ensurePitch();
      const result = await requestJson<{ unchanged?: boolean }>(target, 'Could not save idea check.', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation, version: data.current?.version || 0,
          ...(operation === 'save' ? { title, draft, source } : operation === 'decide' ? { decision, confirmed } : { confirmed: createConfirmed, initialAction: { text: initialAction, dueDate: actionDueDate }, setup: {track:setup.track,piUsername:setup.piUsername.split(',').map(v=>v.trim()).filter(Boolean)[0]||null,pdraUsername:setup.pdraUsername||null,piUsernames:setup.piUsername.split(',').map(v=>v.trim()).filter(Boolean),pdraUsernames:[setup.pdraUsername,...setup.otherPdras.split(',')].map(v=>v.trim()).filter(Boolean),collaborators:setup.collaborators.split(',').map(value=>value.trim()).filter(Boolean)} }) }) });
      removeChecklistDraft(storageKey); restored.current = null;
      const payload = await requestJson<IdeaCheckPayload>(target, 'Saved, but could not refresh. Reload to see the saved record.');
      setData(payload); setExportFormat(defaultPitchExportFormat(payload.current?.source?.name)); setTitle(payload.pitch.title); setDraft(ideaDraftSchema.parse(payload.current!.draft)); if (payload.current!.draft.track) setSetup(current => ({ ...current, track: payload.current!.draft.track })); setConfirmed(false); setCreateConfirmed(false);
      await onChanged(resolvedId.current);
      if (operation === 'create_project') await onProjectCreated();
      setStatus(result.unchanged ? 'No changes to save. The current version and decision are unchanged.' : operation === 'save' ? 'Draft saved. Human decision pending.' : operation === 'decide' ? 'Human decision saved. No project created.' : 'Project created. The original pitch is retained.');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not save.'); }
    finally { setBusy(false); }
  }
  const formId = `${prefix}-form`;
  const locked = busy || Boolean(conflictingDraft);
  const savedDecision = data?.current?.decision || null;
  const canExport = Boolean(data?.canManage && savedDecision?.outcome === 'proceed' && !dirty);
  const conversionOpen = Boolean(data?.canManage && !data.pitch.projectId && savedDecision?.outcome === 'proceed' && !dirty);
  const changedBlocks = ideaFields.filter(field => draft[field.key] !== (data?.current?.draft[field.key] || '')).length;
  const reviewIsStale = (pitchVersion: number) => JSON.stringify(data?.history.find((revision) => revision.version === pitchVersion)?.draft) !== JSON.stringify(data?.current?.draft);
  return <section className="checklist-record project-idea-check" aria-busy={busy}>
    <div className="checklist-record-main">
    {conflictingDraft && <section role="status" className="ops-notice"><p>The saved version changed. Choose your local draft or the saved version.</p>
      <div className="checklist-inline-actions">
        <button type="button" className="ops-secondary" onClick={() => { setTitle(conflictingDraft.title); setDraft(conflictingDraft.draft); setSource(conflictingDraft.source); setPasted(conflictingDraft.pasted); setConflictingDraft(null); }}>Restore local draft</button>
        <button type="button" className="ops-secondary" onClick={() => setConflictingDraft(null)}>Use saved version</button>
      </div>
    </section>}
    {error && <p role="alert" className="ops-notice error">{error} {data?.current && <button type="button" className="ops-secondary" disabled={locked} onClick={() => { if (dirty) setReloadConfirmOpen(true); else setReload((value) => value + 1); }}>Reload saved version</button>}</p>}
    {status && <p role="status" className="form-message">{status}</p>}
    {!data ? <p role="status" className="checklist-hint">{error ? 'Idea check unavailable.' : 'Loading idea check…'}</p> : <>
      <div className="checklist-record-head">
        <label className="checklist-record-label" htmlFor={`${prefix}-title`}>Pitch title</label>
        {/* A single-line title that wraps instead of clipping long titles; line breaks are not part of a title. */}
        <textarea id={`${prefix}-title`} form={formId} className="checklist-record-title" rows={1} disabled={locked} readOnly={!data.canEdit} required={data.canEdit} maxLength={200} value={title} onKeyDown={(event) => { if (event.key === 'Enter') event.preventDefault(); }} onChange={(event) => { setTitle(event.target.value.replace(/\s*\n\s*/g, ' ')); setConfirmed(false); setCreateConfirmed(false); }} placeholder="e.g. Smaller models for low-cost research" />
        {resolvedId.current && <h2 className="vs-sr-only">{data.pitch.id ? data.pitch.title : 'Unsaved pitch'}</h2>}
        <div className="checklist-record-meta">
          <span className="vs-mono">{data.current ? `v${data.current.version} · saved ${formatDayTime(data.current.at)} by @${data.current.by}` : 'Not saved yet'}</span>
          {data.canManage && <span className="checklist-private"><Lock aria-hidden="true" />Private · history visible to the proposer, PI and administrators{data.collaborators.length ? ` · read-only copy shared with ${data.collaborators.length}` : ''}</span>}
          <label className="checklist-inline-field">Track
            <select value={draft.track} disabled={locked || !data.canEdit} onChange={event => { setDraft({ ...draft, track: event.target.value as '' | 'A' | 'B' }); setConfirmed(false); setCreateConfirmed(false); }}>
              <option value="">Select a track</option><option value="A">A — Flagship</option><option value="B">B — Momentum</option>
            </select>
          </label>
          {resolvedId.current && data.canEdit && <button type="button" className="ops-secondary checklist-quiet-button" disabled={locked} onClick={() => setDeleteOpen(true)}><Trash2 aria-hidden="true" />Delete pitch</button>}
        </div>
        <p className="checklist-hint">Draft text stays until sign-out; files must be reselected after refresh.</p>
      </div>
      {!data.canManage && <p role="status" className="ops-notice">Read only · Latest pitch. History, sources and AI reviews are private.</p>}
      {source && <details className="checklist-import"><summary>Source text: {source.name}</summary><pre className="checklist-source-text">{source.text}</pre></details>}
      {data.canEdit && <details className="checklist-import idea-import" open={importOpen} onToggle={event => setImportOpen(event.currentTarget.open)}>
        <summary>Start from an existing document</summary>
        <p id={`${prefix}-import-hint`} className="checklist-hint">32,000 characters max. Text-based PDFs only; check for missing images or equations.</p>
        <fieldset disabled={locked} className="idea-source-inputs"><legend className="vs-sr-only">Upload or paste</legend>
          <label className="idea-dropzone"><Upload aria-hidden="true" /><span className="idea-dropzone-title">Upload pitch document</span><span className="idea-dropzone-hint">{upload ? upload.name : 'TXT, MD, DOCX, PDF or PPTX, up to 5 MB'}</span><input type="file" aria-describedby={`${prefix}-import-hint`} accept=".txt,.md,.docx,.pdf,.pptx" onChange={(event) => { setUpload(event.target.files?.[0] || null); setPreview(null); }} /></label>
          <label className="idea-paste">Or paste the full pitch <textarea aria-describedby={`${prefix}-import-hint`} rows={5} maxLength={32000} value={pasted} placeholder="Paste pitch text" onChange={(event) => { setPasted(event.target.value); setPreview(null); }} /></label>
          <div className="idea-import-actions">
            <button type="button" className="ops-secondary" disabled={(!upload && !pasted.trim()) || Boolean(upload && pasted.trim())} onClick={() => void prepareImport()}>Preview extracted blocks</button>
            {upload && pasted.trim() && <p>Clear the file or the pasted text to choose one source.</p>}
          </div>
        </fieldset>
        {preview && <div className="idea-preview"><h4>Review extracted blocks before applying</h4>
          <p>Apply replaces blocks without saving. Missing fields stay empty.</p>
          <details><summary>Extracted source: {preview.source.name}</summary><pre className="checklist-source-text">{preview.source.text}</pre></details>
          <dl>{preview.title && <div><dt>Suggested title</dt><dd>{preview.title}</dd></div>}<div><dt>Track</dt><dd>{preview.draft.track || 'Missing — fill in yourself'}</dd></div>{ideaFields.map((field) => <div key={field.key}><dt>{field.label}</dt><dd>{preview.draft[field.key] || 'Missing — fill in yourself'}</dd></div>)}</dl>
          {preview.title && preview.title !== title && <p>{title.trim() ? 'Your title stays unless you choose the suggestion.' : 'The suggestion fills the empty title.'}</p>}
          <div className="checklist-inline-actions">
            <button type="button" className="ops-secondary" disabled={locked} onClick={() => { setDraft(preview.draft); setSource(preview.source); if (!title.trim() && preview.title) setTitle(preview.title); setPreview(null); setConfirmed(false); setCreateConfirmed(false); setStatus('Preview applied to unsaved blocks. Review and save the draft.'); }}>Replace blocks with this preview</button>
            {preview.title && title.trim() && preview.title !== title && <button type="button" className="ops-secondary" disabled={locked} onClick={() => { setTitle(preview.title!); setConfirmed(false); setCreateConfirmed(false); }}>Use suggested title</button>}
          </div>
        </div>}
      </details>}
      <form id={formId} className="idea-writing-sheet" onSubmit={(event) => { event.preventDefault(); void save('save'); }}>
        <fieldset disabled={locked} className="checklist-blocks idea-fields"><legend className="vs-sr-only">Pitch blocks</legend>
          {ideaFields.map((field, index) => {
            const [, number = String(index + 1), heading = field.label] = /^(\d+)\.\s*(.*)$/.exec(field.label) || [];
            return <div key={field.key} className="checklist-block">
              <div className="checklist-block-head">
                <span className="checklist-block-num" aria-hidden="true">{number.padStart(2, '0')}</span>
                <label htmlFor={`${prefix}-${field.key}`}><span className="vs-sr-only">{number}.</span> {heading}</label>
                {!checks[index].present && <span className="checklist-empty-chip">Empty</span>}
              </div>
              {/* The guidance is the placeholder; rows are a fallback where CSS field-sizing is unsupported. */}
              <textarea id={`${prefix}-${field.key}`} readOnly={!data.canEdit} placeholder={field.hint} rows={field.hint.split('\n').length + 2} maxLength={24000}
                value={draft[field.key] || ''} onChange={event => { setDraft({ ...draft, [field.key]: event.target.value }); setConfirmed(false); setCreateConfirmed(false); }} />
            </div>;
          })}
        </fieldset>
      </form>
      {data.canManage && (data.pitch.projectId ? <p role="status" className="form-message">Created project: {data.pitch.title}. Find it under Projects.</p> : conversionOpen && <form id={`${prefix}-convert`} className="idea-convert" onSubmit={(event) => { event.preventDefault(); void save('create_project'); }}>
        <fieldset disabled={locked}><legend>Create a project from this pitch</legend>
          <p>Creates a project; locks the approved pitch.</p>
          <p>Approved next milestone: {savedDecision!.nextMilestone}</p>
          <div className="checklist-field-grid">
            <label>Project track<select value={setup.track} onChange={event=>{setSetup({...setup,track:event.target.value});setCreateConfirmed(false);}}><option value="A">Track A — Flagship</option><option value="B">Track B — Momentum</option></select></label>
            <label>Project PI usernames (required)<input required value={setup.piUsername} onChange={event=>{setSetup({...setup,piUsername:event.target.value});setCreateConfirmed(false);}} placeholder="Comma-separated active PI accounts" /></label>
            <label>Lead PDRA reviewer username (required)<input required value={setup.pdraUsername} onChange={event=>{setSetup({...setup,pdraUsername:event.target.value});setCreateConfirmed(false);}} placeholder="Required active reviewer account" /></label>
            <label>Other PDRA usernames<input value={setup.otherPdras} onChange={event=>{setSetup({...setup,otherPdras:event.target.value});setCreateConfirmed(false);}} placeholder="Comma-separated optional reviewer accounts" /></label>
            <label>Project collaborator usernames<input value={setup.collaborators} onChange={event=>{setSetup({...setup,collaborators:event.target.value});setCreateConfirmed(false);}} placeholder="Comma-separated account usernames" /></label>
          </div>
          <p>Assign project access here; pitch access does not carry over.</p>
          <label>First next action <textarea required maxLength={240} rows={2} value={initialAction} onChange={(event) => { setInitialAction(event.target.value); setCreateConfirmed(false); }} /></label>
          <label className="checklist-field-narrow">Action deadline <input required type="date" value={actionDueDate} onChange={(event) => { setActionDueDate(event.target.value); setCreateConfirmed(false); }} /></label>
          <p>Action owner: @{data.pitch.ownerUsername}. Manage tasks in Projects.</p>
          <label className="checklist-confirm"><input type="checkbox" required checked={createConfirmed} onChange={(event) => setCreateConfirmed(event.target.checked)} /> I confirm this approved pitch should now become a project.</label>
          <button type="submit" className="ops-primary" disabled={!createConfirmed}>Create project</button>
        </fieldset>
      </form>)}
      {(data.canEdit || data.canManage) && <div className="checklist-action-bar">
        <span className={`checklist-bar-state${dirty ? ' is-dirty' : data.current ? '' : ' is-idle'}`}>{dirty ? (changedBlocks ? `Unsaved changes in ${changedBlocks} block${changedBlocks === 1 ? '' : 's'}` : 'Unsaved changes') : data.current ? 'All changes saved' : 'Not saved yet'}</span>
        {data.canManage && savedDecision?.outcome === 'proceed' && (canExport ? <div className="checklist-export idea-export" aria-label="Download approved pitch" role="group" title="Approved title, sections and decision only; excludes drafts, sources and AI reviews.">
          <label>Download format <select value={exportFormat} disabled={locked} onChange={(event) => setExportFormat(event.target.value as PitchExportFormat)}>
            <option value="docx">Word (.docx)</option><option value="pdf">PDF (.pdf)</option><option value="md">Markdown (.md)</option><option value="txt">Plain text (.txt)</option>
          </select></label>
          <button type="button" className="ops-secondary" disabled={locked} onClick={() => void downloadPitch()}><Download aria-hidden="true" />Download approved pitch</button>
        </div> : <span className="checklist-bar-note">Export requires a saved Proceed decision.</span>)}
        {data.canManage && !data.pitch.projectId && (conversionOpen
          ? <a className="ops-secondary checklist-link-button" href={`#${prefix}-convert`}>Convert to project</a>
          : <button type="button" className="ops-secondary" disabled title="Available after a saved Proceed decision">Convert to project</button>)}
        {data.canEdit && <button className="ops-primary" type="submit" form={formId} disabled={locked || !dirty} title={dirty ? undefined : 'No unsaved changes'}>Save pitch draft</button>}
      </div>}
    </>}
    </div>
    {data && <aside className="checklist-rail" aria-label="Advice and decisions">
      {data.canManage && <section className="checklist-advice idea-review-results" aria-labelledby={`${prefix}-advice-heading`}>
        <div className="checklist-advice-head">
          <h3 id={`${prefix}-advice-heading`}>Agent advice</h3>
          <span className="checklist-advisory-tag">Advisory</span>
        </div>
        {data.reviews[0] && !isLegacyIdeaReview(data.reviews[0].report) && (() => {
          const readiness = reviewReadiness(data.reviews[0].report);
          return <div className="idea-readiness">
            <span className={`checklist-advice-status is-${readinessTone[readiness.tone]}`}>{readiness.label}</span>
            <small className="checklist-advice-meta">Based on review of <span className="vs-mono">v{data.reviews[0].pitchVersion}</span>{reviewIsStale(data.reviews[0].pitchVersion) ? ', before the latest changes' : ''}. Advisory only.</small>
          </div>;
        })()}
        <p className="checklist-advice-meta">{data.reviews[0] ? <>Latest review of <span className="vs-mono">v{data.reviews[0].pitchVersion}</span> · <span className="vs-mono">{formatDayTime(data.reviews[0].at)}</span>. </> : 'No AI review yet. '}Advisory only; approval is separate.</p>
        {data.reviews.map((review) => <details key={review.id} className="idea-review" open={review === data.reviews[0]}>
          <summary>Review of <span className="vs-mono">v{review.pitchVersion}</span> · {reviewHeadline(review.report)}{reviewIsStale(review.pitchVersion) ? ' · Draft changed — review again' : ''}</summary>
          <IdeaReviewReport report={review.report} />
          <small className="checklist-advice-meta">@{review.by} · <span className="vs-mono">{formatDayTime(review.at)}</span> · {review.model} · Rules <span className="vs-mono">{review.rulesHash.slice(0, 12)}</span></small>
        </details>)}
        {data.canEdit && <button type="button" className="ops-secondary checklist-advice-run" disabled={busy || dirty || !data.current} onClick={() => void runReview()}>Check pitch with AI</button>}
        {data.canEdit && (dirty || !data.current) && <p className="checklist-advice-meta">Save the draft before checking it.</p>}
        {busy && <p role="status" className="checklist-advice-meta">Working…</p>}
      </section>}
      <section className="checklist-step idea-decision" aria-labelledby={`${prefix}-decision-heading`}>
        <h3 id={`${prefix}-decision-heading`}>Human decision</h3>

        <p className="checklist-step-state">{savedDecision ? <Check aria-hidden="true" /> : <Clock aria-hidden="true" />}<span><strong>{savedDecision ? `Current decision: ${ideaOutcomeLabels[savedDecision.outcome]}` : data.current ? 'Awaiting a human decision' : 'Save a draft before a decision'}</strong>{dirty && data.current ? ' · Unsaved changes' : ''}</span></p>
        {savedDecision && <dl className="idea-decision-record"><div><dt>Reason / evidence</dt><dd>{savedDecision.rationale}</dd></div><div><dt>Next milestone or closure</dt><dd>{savedDecision.nextMilestone}</dd></div></dl>}
        {data.canEdit && <form onSubmit={(event) => { event.preventDefault(); void save('decide'); }}>
          <fieldset disabled={locked || !data.current || dirty}><legend className="vs-sr-only">Record the human decision</legend>
            <p className="checklist-hint">Risk or early negative results alone do not justify stopping.</p>
            <label>Decision <select value={decision.outcome} onChange={(event) => { setDecision({ ...decision, outcome: event.target.value as IdeaDecision['outcome'] }); setConfirmed(false); setCreateConfirmed(false); }}>
              <option value="revise">Revise and test again</option><option value="proceed">Proceed with this scope</option><option value="stop">Stop this idea</option>
            </select></label>
            <label>Reason and evidence <textarea required rows={3} maxLength={4000} value={decision.rationale} onChange={(event) => { setDecision({ ...decision, rationale: event.target.value }); setConfirmed(false); setCreateConfirmed(false); }} /></label>
            <label>Next milestone or closure plan <textarea required rows={2} maxLength={2000} value={decision.nextMilestone} onChange={(event) => { setDecision({ ...decision, nextMilestone: event.target.value }); setConfirmed(false); setCreateConfirmed(false); }} /></label>
            <label className="checklist-confirm"><input type="checkbox" required checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> I confirm this records the human decision after discussion with the supervisory team.</label>
            <button className="ops-primary" type="submit" disabled={!confirmed || (decision.outcome === 'proceed' && missing.length > 0)}>Confirm decision</button>
            {decision.outcome === 'proceed' && missing.length > 0 && <p className="checklist-hint">Fill the missing sections and save before confirming Proceed.</p>}
          </fieldset>
          {(!data.current || dirty) && <p className="checklist-advice-meta">Save your draft before recording a decision.</p>}
        </form>}
        {data.canManage && !data.canEdit && <p>Converted · Read only; cannot be deleted.</p>}
      </section>
      {data.canManage && data.pitch.id && <IdeaPitchSharing pitchId={data.pitch.id} owner={data.pitch.ownerUsername} collaborators={data.collaborators} disabled={locked} onBusyChanged={setSharingBusy} onChanged={async () => {
        const payload = await requestJson<IdeaCheckPayload>(url, 'Sharing changed, but could not refresh the collaborator list.');
        // Sharing must not advance the version used by an unsaved draft.
        setData(current => current ? { ...current, collaborators: payload.collaborators } : current);
      }} />}
      {data.canManage && <section className="checklist-step idea-history" aria-labelledby={`${prefix}-history-heading`}><h3 id={`${prefix}-history-heading`}>History</h3>
        {!data.history.length && <p>Your saved versions will appear here.</p>}
        {data.history.map((revision) => <details key={revision.version}><summary><span className="vs-mono">v{revision.version}</span> · @{revision.by} · <span className="vs-mono">{formatDayTime(revision.at)}</span> · {revision.decision ? `Decision: ${ideaOutcomeLabels[revision.decision.outcome]}` : 'Draft saved · awaiting decision'}</summary>
          {revision.title && <p>Title: {revision.title}</p>}
          {revision.source && <details><summary>Source: {revision.source.name}</summary><pre className="checklist-source-text">{revision.source.text}</pre></details>}
          {revision.decision && <><p>{revision.decision.rationale}</p><p>{revision.decision.nextMilestone}</p></>}
          <dl>{ideaFields.map((field) => <div key={field.key}><dt>{field.label}</dt><dd>{revision.draft[field.key] || 'Not recorded'}</dd></div>)}</dl>
        </details>)}
      </section>}
    </aside>}
    <ConfirmDialog id="idea-reload-confirm" open={reloadConfirmOpen} tone="default" title="Reload the saved version?"
      message="Your unsaved changes in this pitch will be discarded and the last saved version will be shown."
      confirmLabel="Discard and reload" cancelLabel="Keep editing" onCancel={() => setReloadConfirmOpen(false)} onConfirm={() => { setReloadConfirmOpen(false); setReload((value) => value + 1); }} />
    {data?.pitch.id && <ConfirmDialog id="idea-delete-confirm" open={deleteOpen} title="Delete this pitch?" busy={busy}
      message={`This permanently removes “${data.pitch.title}”, all its versions, source text and AI reviews. It cannot be undone.`}
      confirmLabel="Permanently delete pitch" confirmPhrase={{ value: data.pitch.title, label: 'Type the pitch title to confirm' }}
      onCancel={() => setDeleteOpen(false)} onConfirm={() => void removePitch()} />}
  </section>;
}

type ReviewReport = SavedIdeaReview['report'];
const sentence = (value: string) => value.charAt(0).toUpperCase() + value.slice(1).replaceAll('_', ' ').toLowerCase();
const readinessTone = { ready: 'ok', nearly: 'warn', not: 'danger' } as const;
// Review statuses as dot + word tones.
const adviceTone: Record<string, string> = { supported: 'ok', adequate: 'ok', strong: 'ok', addressed: 'ok', needs_work: 'warn', partial: 'warn', missing: 'danger', unanswered: 'danger' };
const blockLabel = (field: string) => ideaFields.find(item => item.key === field)?.label || 'Track';
export function reviewHeadline(report: ReviewReport) {
  if (isLegacyIdeaReview(report)) return `Earlier eight-criteria review · ${report.recommendation.replaceAll('_', ' ')}`;
  const missing = report.blocks.filter(item => item.status === 'missing').length;
  const needsWork = report.blocks.filter(item => item.status === 'needs_work').length;
  return missing || needsWork ? [missing && `${missing} missing`, needsWork && `${needsWork} need${needsWork === 1 ? 's' : ''} work`].filter(Boolean).join(' · ') : 'All blocks adequate or better';
}
const blocks = (count: number) => `${count} block${count === 1 ? '' : 's'}`;
/** Deterministic, advisory readiness derived from a saved v2 review; never asked from the model and never a decision. */
export function reviewReadiness(report: IdeaReview): { tone: 'ready' | 'nearly' | 'not'; label: string } {
  const missing = report.blocks.filter(item => item.status === 'missing').length;
  const needsWork = report.blocks.filter(item => item.status === 'needs_work').length;
  const answered = report.discussant.delta.status === 'addressed' && report.discussant.poc.status === 'addressed';
  // Only a missing block makes a pitch not ready; anything short of all blocks adequate and both questions addressed is "nearly".
  if (!missing && !needsWork && answered) return { tone: 'ready', label: 'Ready for group discussion' };
  if (!missing) return { tone: 'nearly', label: needsWork ? `Nearly ready — ${blocks(needsWork)} need${needsWork === 1 ? 's' : ''} work` : 'Nearly ready — discussant questions need fuller answers' };
  return { tone: 'not', label: `Not ready for discussion — ${[missing && `${blocks(missing)} missing`, needsWork && `${blocks(needsWork)} need${needsWork === 1 ? 's' : ''} work`].filter(Boolean).join(', ')}` };
}
function Quotes({ evidence, own }: { evidence: Array<{ field: string; quote: string }>; own?: string }) {
  return evidence.map((item, index) => <blockquote key={index}>{item.field === own ? '' : `${blockLabel(item.field)}: `}{item.quote}</blockquote>);
}
export function IdeaReviewReport({ report }: { report: ReviewReport }) {
  if (isLegacyIdeaReview(report)) return <>
    <p className="idea-review-summary">{report.summary}</p>
    <ul className="checklist-advice-list">{report.checks.map((check) => <li key={check.field}>
      <span className="checklist-advice-row"><strong>{sentence(check.field.replaceAll(/([A-Z])/g, ' $1'))}</strong><span className={`checklist-advice-status is-${adviceTone[check.status] || 'muted'}`}>{sentence(check.status)}</span></span>
      <p>{check.assessment}</p>
      <Quotes evidence={check.evidence} />
      <p className="checklist-advice-improve">Improve: {check.improvement}</p>
    </li>)}</ul>
    <h4>Next tests</h4><ol>{report.nextSteps.map((step, index) => <li key={index}>{step}</li>)}</ol>
  </>;
  const order = ideaFields.map(item => item.key as string);
  return <>
    <p className="idea-review-summary">{report.summary}</p>
    <ul className="checklist-advice-list">{[...report.blocks].sort((a, b) => order.indexOf(a.block) - order.indexOf(b.block)).map((item) => <li key={item.block}>
      <span className="checklist-advice-row"><strong>{blockLabel(item.block)}</strong><span className={`checklist-advice-status is-${adviceTone[item.status] || 'muted'}`}>{ideaBlockStatusLabels[item.status]}</span></span>
      {item.focus.length > 0 && <small className="checklist-advice-meta">{item.focus.join(' · ')}</small>}
      <p>{item.gap}</p>
      <Quotes evidence={item.evidence} own={item.block} />
      <p className="checklist-advice-improve">Improve: {item.improvement}</p>
    </li>)}</ul>
    <h4>Discussant questions</h4>
    <ul className="checklist-advice-list">{(['delta', 'poc'] as const).map((key) => <li key={key}>
      <span className="checklist-advice-row"><strong>{ideaDiscussantQuestions[key]}</strong><span className={`checklist-advice-status is-${adviceTone[report.discussant[key].status] || 'muted'}`}>{ideaDiscussantStatusLabels[report.discussant[key].status]}</span></span>
      <p>{report.discussant[key].answer}</p>
      <Quotes evidence={report.discussant[key].evidence} />
    </li>)}</ul>
    <h4>Next steps</h4><ol>{report.nextSteps.map((step, index) => <li key={index}>{step}</li>)}</ol>
  </>;
}
