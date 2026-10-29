'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Check, Clock, Compass, Download, Lock, Trash2, Upload } from 'lucide-react';
import { IdeaPitchSharing } from './idea-pitch-sharing';
import { checklistDraftKey, readChecklistDraft, writeChecklistDraft, removeChecklistDraft } from './checklist-drafts';
import { requestJson } from './client-request';
import { ConfirmDialog } from './confirm-dialog';
import { checkIdea, ideaDraftSchema, ideaFields, defaultPitchExportFormat, type PitchExportFormat, type IdeaCheckPayload, type IdeaDecision, type IdeaDraft, type IdeaSource } from '../src/mastra/projects/idea-check';
import { ideaBlockStatusLabels, ideaDiscussantQuestions, ideaDiscussantStatusLabels, isLegacyIdeaReview, type SavedIdeaReview } from '../src/mastra/projects/idea-review-schema';

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
  const [preview, setPreview] = useState<{ draft: IdeaDraft; source: IdeaSource } | null>(null);
  const [decision, setDecision] = useState<IdeaDecision>({ outcome: 'revise', rationale: '', nextMilestone: '' });
  const [confirmed, setConfirmed] = useState(false);
  const [createConfirmed, setCreateConfirmed] = useState(false);
  const [initialAction, setInitialAction] = useState('');
  const [setup, setSetup] = useState({track:'A',piUsername:'',pdraUsername:'',collaborators:''});
  const [actionDueDate, setActionDueDate] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmed, setDeleteConfirmed] = useState(false);
  const [operationBusy, setBusy] = useState(false);
  const [sharingBusy, setSharingBusy] = useState(false);
  const busy = operationBusy || sharingBusy;
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [reload, setReload] = useState(0);
  const [reloadConfirmOpen, setReloadConfirmOpen] = useState(false);
  const url = `/api/idea-pitches/${encodeURIComponent(resolvedId.current)}`;
  async function ensurePitch() {
    if (!resolvedId.current) {
      if (!title.trim()) throw new Error('Enter a pitch title before importing or saving.');
      const result = await requestJson<{ id: string }>('/api/idea-pitches', 'Could not create pitch.', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: title.trim() }) });
      resolvedId.current = result.id;
      // Import creates the record before any save; list it now so it can be picked even if extraction fails.
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
      const target = await ensurePitch();
      const form = new FormData(); if (upload) form.set('file', upload); if (pasted.trim()) form.set('text', pasted);
      setPreview(await requestJson<{ draft: IdeaDraft; source: IdeaSource }>(`${target}/import`, 'Could not organise the document.', { method: 'POST', body: form }));
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
    } catch (caught) { setError('Could not complete the AI review. Your saved draft is unchanged. Try Check pitch with AI again.'); }
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
      const link = document.createElement('a'); link.href = objectUrl; link.download = `idea-pitch-v${data.current.version}.${exportFormat}`;
      document.body.append(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
      setStatus('Approved pitch downloaded.');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not download.'); }
    finally { setBusy(false); }
  }
  async function removePitch() {
    if (!deleteConfirmed || !data || !resolvedId.current) return;
    setBusy(true); setError('');
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
      await requestJson(target, 'Could not save idea check.', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation, version: data.current?.version || 0,
          ...(operation === 'save' ? { title, draft, source } : operation === 'decide' ? { decision, confirmed } : { confirmed: createConfirmed, initialAction: { text: initialAction, dueDate: actionDueDate }, setup: {...setup,piUsername:setup.piUsername||null,pdraUsername:setup.pdraUsername||null,collaborators:setup.collaborators.split(',').map(value=>value.trim()).filter(Boolean)} }) }) });
      removeChecklistDraft(storageKey); restored.current = null;
      const payload = await requestJson<IdeaCheckPayload>(target, 'Saved, but could not refresh. Reload to see the saved record.');
      setData(payload); setExportFormat(defaultPitchExportFormat(payload.current?.source?.name)); setTitle(payload.pitch.title); setDraft(ideaDraftSchema.parse(payload.current!.draft)); if (payload.current!.draft.track) setSetup(current => ({ ...current, track: payload.current!.draft.track })); setConfirmed(false); setCreateConfirmed(false);
      await onChanged(resolvedId.current);
      if (operation === 'create_project') await onProjectCreated();
      setStatus(operation === 'save' ? 'Draft saved. Human decision pending.' : operation === 'decide' ? 'Human decision saved. No project created.' : 'Project created. The original pitch is retained.');
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
  return <section className="project-idea-check" aria-busy={busy}>
    <div className="idea-editor-main">
    {conflictingDraft && <section role="status" className="ops-notice idea-conflict"><p>Your local draft is retained separately because the saved version changed. Choose which text to continue with before saving.</p>
      <div className="idea-inline-actions">
        <button type="button" className="ops-secondary" onClick={() => { setTitle(conflictingDraft.title); setDraft(conflictingDraft.draft); setSource(conflictingDraft.source); setPasted(conflictingDraft.pasted); setConflictingDraft(null); }}>Restore local draft</button>
        <button type="button" className="ops-secondary" onClick={() => setConflictingDraft(null)}>Use saved version</button>
      </div>
    </section>}
    {error && <p role="alert" className="ops-notice error idea-alert">{error} <button type="button" className="ops-secondary" disabled={locked} onClick={() => { if (dirty) setReloadConfirmOpen(true); else setReload((value) => value + 1); }}>Reload saved version</button></p>}
    {status && <p role="status" className="form-message idea-status">{status}</p>}
    {!data ? <p role="status" className="idea-loading">{error ? 'Idea check unavailable.' : 'Loading idea check…'}</p> : <>
      <div className="idea-title-block">
        <label className="idea-title-label" htmlFor={`${prefix}-title`}>Pitch title</label>
        <input id={`${prefix}-title`} form={formId} className="idea-title-input" disabled={locked} readOnly={!data.canEdit} required={data.canEdit} maxLength={200} value={title} onChange={(event) => { setTitle(event.target.value); setConfirmed(false); setCreateConfirmed(false); }} placeholder="e.g. Smaller models for low-cost research" />
        <div className="idea-record-header">
          {resolvedId.current && <h2 className="vs-sr-only">{data.pitch.id ? data.pitch.title : 'Unsaved pitch'}</h2>}
          <p className="idea-meta">
            <span className="vs-mono">{data.current ? `v${data.current.version} · saved ${formatRecordTime(data.current.at)} by @${data.current.by}` : 'Not saved yet'}</span>
            {data.canManage && <span className="idea-private"><Lock aria-hidden="true" />Private · history visible to the proposer, PI and administrators{data.collaborators.length ? ` · read-only copy shared with ${data.collaborators.length}` : ''}</span>}
          </p>
          {resolvedId.current && data.canEdit && <button type="button" className="ops-secondary idea-delete-button" disabled={locked} onClick={() => { setDeleteOpen(true); setDeleteConfirmed(false); }}><Trash2 aria-hidden="true" />Delete pitch</button>}
        </div>
        <p className="idea-hint">Draft text is kept in this browser tab until sign-out. Use Save pitch draft to save a version. Select uploaded files again after refreshing.</p>
      </div>
      {deleteOpen && <section className="idea-delete-confirm" aria-labelledby={`${prefix}-delete-heading`}>
        <h3 id={`${prefix}-delete-heading`}>Delete this pitch?</h3>
        <p>This permanently removes “{data.pitch.id ? data.pitch.title : title || 'Untitled idea'}”, all its versions, source text and AI reviews. It cannot be undone.</p>
        <label className="idea-confirm"><input type="checkbox" checked={deleteConfirmed} disabled={locked} onChange={(event) => setDeleteConfirmed(event.target.checked)} /> I understand this pitch and its history will be deleted.</label>
        <div className="idea-inline-actions"><button type="button" className="ops-secondary" disabled={locked} onClick={() => setDeleteOpen(false)}>Cancel</button><button type="button" className="ops-secondary danger" disabled={busy || !deleteConfirmed} onClick={() => void removePitch()}>Permanently delete pitch</button></div>
      </section>}
      {!data.canManage && <p role="status" className="ops-notice idea-readonly">Shared with you · Read only. You can see the latest saved pitch; private history, source documents and AI reviews are not shared.</p>}
      {source && <details className="idea-source"><summary>Source text: {source.name}</summary><pre className="idea-source-text">{source.text}</pre></details>}
      {data.canEdit && <section className="idea-import" aria-labelledby={`${prefix}-import-heading`}>
        <h3 id={`${prefix}-import-heading`}>Start from an existing document</h3>
        <p id={`${prefix}-import-hint`}>Upload TXT, MD, DOCX, text-based PDF or PPTX (up to 5 MB), or paste up to 32,000 characters. Check extracted text for missing images or equations.</p>
        <fieldset disabled={locked} className="idea-source-inputs"><legend>Upload or paste</legend>
          <label className="idea-dropzone"><Upload aria-hidden="true" /><span className="idea-dropzone-title">Upload pitch document</span><span className="idea-dropzone-hint">{upload ? upload.name : 'TXT, MD, DOCX, PDF or PPTX, up to 5 MB'}</span><input type="file" aria-describedby={`${prefix}-import-hint`} accept=".txt,.md,.docx,.pdf,.pptx" onChange={(event) => { setUpload(event.target.files?.[0] || null); setPreview(null); }} /></label>
          <label className="idea-paste">Or paste the full pitch <textarea aria-describedby={`${prefix}-import-hint`} rows={5} maxLength={32000} value={pasted} placeholder="Paste text here, then preview the extracted blocks." onChange={(event) => { setPasted(event.target.value); setPreview(null); }} /></label>
          <div className="idea-import-actions">
            <button type="button" className="ops-secondary" disabled={(!upload && !pasted.trim()) || Boolean(upload && pasted.trim())} onClick={() => void prepareImport()}>Preview extracted blocks</button>
            {upload && pasted.trim() && <p>Clear the file or the pasted text to choose one source.</p>}
          </div>
        </fieldset>
        {preview && <div className="idea-preview"><h4>Review extracted blocks before applying</h4>
          <p>Only exact excerpts are placed into blocks. Missing information stays empty. Applying replaces the current blocks but does not save them.</p>
          <details><summary>Extracted source: {preview.source.name}</summary><pre className="idea-source-text">{preview.source.text}</pre></details>
          <dl><div><dt>Track</dt><dd>{preview.draft.track || 'Missing — fill in yourself'}</dd></div>{ideaFields.map((field) => <div key={field.key}><dt>{field.label}</dt><dd>{preview.draft[field.key] || 'Missing — fill in yourself'}</dd></div>)}</dl>
          <button type="button" className="ops-secondary" disabled={locked} onClick={() => { setDraft(preview.draft); setSource(preview.source); setPreview(null); setConfirmed(false); setCreateConfirmed(false); setStatus('Preview applied to unsaved blocks. Review and save the draft.'); }}>Replace blocks with this preview</button>
        </div>}
      </section>}
      <form id={formId} className="idea-writing-sheet" onSubmit={(event) => { event.preventDefault(); void save('save'); }}>
        <fieldset disabled={locked} className="idea-fields"><legend>Pitch blocks</legend>
          <p className="idea-completeness">{missing.length ? `${missing.length} of ${checks.length} blocks still need information. You can save an incomplete draft.` : 'All blocks contain text. A person must still judge the evidence and feasibility.'}</p>
          <div className="idea-setup-row">
            <p className="idea-section-title">Lead: {data.pitch.ownerUsername ? `@${data.pitch.ownerUsername}` : 'You'}</p>
            <label className="idea-track">Track
              <select value={draft.track} disabled={!data.canEdit} onChange={event => { setDraft({ ...draft, track: event.target.value as '' | 'A' | 'B' }); setConfirmed(false); setCreateConfirmed(false); }}>
                <option value="">Select a track</option><option value="A">Track A — Flagship</option><option value="B">Track B — Momentum</option>
              </select>
            </label>
          </div>
          {ideaFields.map((field, index) => {
            const [, number = String(index + 1), heading = field.label] = /^(\d+)\.\s*(.*)$/.exec(field.label) || [];
            return <div key={field.key} className="idea-pitch-block">
              <div className="idea-block-head">
                <label htmlFor={`${prefix}-${field.key}`}><span className="idea-block-num" aria-hidden="true" data-num={number.padStart(2, '0')} /><span className="vs-sr-only">{number}.</span> {heading}</label>
                {!checks[index].present && <span className="idea-empty-chip">Empty</span>}
              </div>
              {/* Wide screens show the guidance beside the textarea; assistive technology reads it from the placeholder. */}
              <p className="idea-block-guide" aria-hidden="true">{field.hint}</p>
              <textarea id={`${prefix}-${field.key}`} readOnly={!data.canEdit} placeholder={field.hint} rows={5} maxLength={24000}
                value={draft[field.key] || ''} onChange={event => { setDraft({ ...draft, [field.key]: event.target.value }); setConfirmed(false); setCreateConfirmed(false); }} />
            </div>;
          })}
        </fieldset>
      </form>
      {data.canManage && (data.pitch.projectId ? <p role="status" className="form-message">Created project: {data.pitch.title}. Find it under Projects.</p> : conversionOpen && <form id={`${prefix}-convert`} className="idea-convert" onSubmit={(event) => { event.preventDefault(); void save('create_project'); }}>
        <fieldset disabled={locked}><legend>Create a project from this pitch</legend>
          <p>The approved question, contribution, validation plan and risks become the initial project research profile. The original approved pitch remains unchanged.</p>
          <p>Approved next milestone: {savedDecision!.nextMilestone}</p>
          <div className="idea-convert-grid">
            <label>Project track<select value={setup.track} onChange={event=>{setSetup({...setup,track:event.target.value});setCreateConfirmed(false);}}><option value="A">Track A — Flagship</option><option value="B">Track B — Momentum</option></select></label>
            <label>Project PI username<input value={setup.piUsername} onChange={event=>{setSetup({...setup,piUsername:event.target.value});setCreateConfirmed(false);}} placeholder="Optional active PI account" /></label>
            <label>PDRA reviewer username<input value={setup.pdraUsername} onChange={event=>{setSetup({...setup,pdraUsername:event.target.value});setCreateConfirmed(false);}} placeholder="Optional active reviewer account" /></label>
            <label>Project collaborator usernames<input value={setup.collaborators} onChange={event=>{setSetup({...setup,collaborators:event.target.value});setCreateConfirmed(false);}} placeholder="Comma-separated account usernames" /></label>
          </div>
          <p>Confirm project access separately. Pitch viewers and the approving PI are not assigned automatically.</p>
          <label>First next action <textarea required maxLength={240} rows={2} value={initialAction} onChange={(event) => { setInitialAction(event.target.value); setCreateConfirmed(false); }} /></label>
          <label className="idea-date">Action deadline <input required type="date" value={actionDueDate} onChange={(event) => { setActionDueDate(event.target.value); setCreateConfirmed(false); }} /></label>
          <p>@{data.pitch.ownerUsername} is responsible for this action. Manage further tasks in Projects. Attach the project when submitting a theme meeting update.</p>
          <label className="idea-confirm"><input type="checkbox" required checked={createConfirmed} onChange={(event) => setCreateConfirmed(event.target.checked)} /> I confirm this approved pitch should now become a project.</label>
          <button type="submit" className="ops-primary" disabled={!createConfirmed}>Create project</button>
        </fieldset>
      </form>)}
      {data.canManage && <details className="idea-history" open><summary>History (all revisions)</summary>
        {!data.history.length && <p>Your saved versions will appear here.</p>}
        {data.history.map((revision) => <details key={revision.version}><summary><span className="vs-mono">v{revision.version}</span> · @{revision.by} · <span className="vs-mono">{formatRecordTime(revision.at)}</span> · {revision.decision?.outcome || 'Draft — review pending'}</summary>
          {revision.title && <p>Title: {revision.title}</p>}
          {revision.source && <details><summary>Source: {revision.source.name}</summary><pre className="idea-source-text">{revision.source.text}</pre></details>}
          {revision.decision && <><p>{revision.decision.rationale}</p><p>{revision.decision.nextMilestone}</p></>}
          <dl>{ideaFields.map((field) => <div key={field.key}><dt>{field.label}</dt><dd>{revision.draft[field.key] || 'Not recorded'}</dd></div>)}</dl>
        </details>)}
      </details>}
    </>}
    </div>
    {data && <aside className="idea-review-rail" aria-label="Advice, decision and sharing">
      {data.canManage && <section className="idea-rail-panel idea-review-results" aria-labelledby={`${prefix}-advice-heading`}>
        <div className="idea-advice-head">
          <span className="idea-advice-mark" aria-hidden="true"><Compass /></span>
          <h3 id={`${prefix}-advice-heading`}>Agent advice</h3>
          <span className="idea-advisory-tag">Advisory</span>
        </div>
        <p className="idea-advice-meta">{data.reviews[0] ? <>Latest review of <span className="vs-mono">v{data.reviews[0].pitchVersion}</span> · <span className="vs-mono">{formatRecordTime(data.reviews[0].at)}</span>. </> : 'No AI review yet. '}The agent gives suggestions on evidence and feasibility. It cannot approve, decide or change a stage.</p>
        {data.reviews.map((review) => <details key={review.id} className="idea-review" open={review === data.reviews[0]}>
          <summary>Review of <span className="vs-mono">v{review.pitchVersion}</span> · {reviewHeadline(review.report)}{reviewIsStale(review.pitchVersion) ? ' · Draft changed — review again' : ''}</summary>
          <IdeaReviewReport report={review.report} />
          <small className="idea-review-provenance">@{review.by} · <span className="vs-mono">{formatRecordTime(review.at)}</span> · {review.model} · Rules <span className="vs-mono">{review.rulesHash.slice(0, 12)}</span></small>
        </details>)}
        {data.canEdit && <button type="button" className="ops-secondary idea-advice-run" disabled={busy || dirty || !data.current} onClick={() => void runReview()}>Check pitch with AI</button>}
        {data.canEdit && (dirty || !data.current) && <p className="idea-advice-meta">Save the draft before checking it.</p>}
        {busy && <p role="status" className="idea-advice-meta">Working…</p>}
      </section>}
      <section className="idea-rail-panel idea-decision" aria-labelledby={`${prefix}-decision-heading`}>
        <h3 id={`${prefix}-decision-heading`}>Decision</h3>
        <p>Recorded by a person after reviewing the saved draft: Proceed, Revise or Stop, with a reason and next milestone. AI feedback alone is not approval.</p>
        <p className="idea-decision-state">{savedDecision ? <Check aria-hidden="true" /> : <Clock aria-hidden="true" />}<span><strong>{savedDecision ? `Current decision: ${savedDecision.outcome}` : data.current ? 'Awaiting a human decision' : 'Save a draft before a decision'}</strong>{dirty && data.current ? ' · Unsaved changes' : ''}</span></p>
        {savedDecision && <dl className="idea-decision-record"><div><dt>Reason / evidence</dt><dd>{savedDecision.rationale}</dd></div><div><dt>Next milestone or closure</dt><dd>{savedDecision.nextMilestone}</dd></div></dl>}
        {data.canEdit && <form onSubmit={(event) => { event.preventDefault(); void save('decide'); }}>
          <fieldset disabled={locked || !data.current || dirty}><legend>Record the human decision</legend>
            <p>Record the outcome agreed with the supervisory team. After Proceed, download the approved document or create a project. High risk or an early negative result alone is not a reason to stop.</p>
            <label>Decision <select value={decision.outcome} onChange={(event) => { setDecision({ ...decision, outcome: event.target.value as IdeaDecision['outcome'] }); setConfirmed(false); setCreateConfirmed(false); }}>
              <option value="revise">Revise and test again</option><option value="proceed">Proceed with this scope</option><option value="stop">Stop this idea</option>
            </select></label>
            <label>Reason and evidence <textarea required rows={3} maxLength={4000} value={decision.rationale} onChange={(event) => { setDecision({ ...decision, rationale: event.target.value }); setConfirmed(false); setCreateConfirmed(false); }} /></label>
            <label>Next milestone or closure plan <textarea required rows={2} maxLength={2000} value={decision.nextMilestone} onChange={(event) => { setDecision({ ...decision, nextMilestone: event.target.value }); setConfirmed(false); setCreateConfirmed(false); }} /></label>
            <label className="idea-confirm"><input type="checkbox" required checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> I confirm this records the human decision after discussion with the supervisory team.</label>
            <button className="ops-secondary" type="submit" disabled={!confirmed || (decision.outcome === 'proceed' && missing.length > 0)}>Confirm decision</button>
            {decision.outcome === 'proceed' && missing.length > 0 && <p>Fill the missing sections and save before confirming Proceed.</p>}
          </fieldset>
          {(!data.current || dirty) && <p className="idea-advice-meta">Save your draft before recording a decision.</p>}
        </form>}
        {data.canManage && !data.canEdit && <p>This pitch has become a project. Its original approval record is read only and cannot be deleted.</p>}
      </section>
      {data.canManage && data.pitch.id && <IdeaPitchSharing pitchId={data.pitch.id} owner={data.pitch.ownerUsername} collaborators={data.collaborators} disabled={locked} onBusyChanged={setSharingBusy} onChanged={async () => {
        const payload = await requestJson<IdeaCheckPayload>(url, 'Sharing changed, but could not refresh the collaborator list.');
        // Sharing must not advance the version used by an unsaved draft.
        setData(current => current ? { ...current, collaborators: payload.collaborators } : current);
      }} />}
    </aside>}
    {data && (data.canEdit || data.canManage) && <div className="idea-action-bar">
      <span className={`idea-bar-state${dirty ? ' is-dirty' : ''}`}>{dirty ? (changedBlocks ? `Unsaved changes in ${changedBlocks} block${changedBlocks === 1 ? '' : 's'}` : 'Unsaved changes') : data.current ? 'All changes saved' : 'Not saved yet'}</span>
      {data.canManage && savedDecision?.outcome === 'proceed' && (canExport ? <div className="idea-export" aria-label="Download approved pitch" role="group" title="Downloads the confirmed title, pitch sections and human decision. Old drafts, source text and AI review history are excluded.">
        <label>Download format <select value={exportFormat} disabled={locked} onChange={(event) => setExportFormat(event.target.value as PitchExportFormat)}>
          <option value="docx">Word (.docx)</option><option value="pdf">PDF (.pdf)</option><option value="md">Markdown (.md)</option><option value="txt">Plain text (.txt)</option>
        </select></label>
        <button type="button" className="ops-secondary" disabled={locked} onClick={() => void downloadPitch()}><Download aria-hidden="true" />Download approved pitch</button>
      </div> : <span className="idea-bar-note">Export is available after saving and confirming a human Proceed decision.</span>)}
      {data.canManage && !data.pitch.projectId && (conversionOpen
        ? <a className="ops-secondary idea-convert-link" href={`#${prefix}-convert`}>Convert to project</a>
        : <button type="button" className="ops-secondary" disabled title="Available after a saved Proceed decision">Convert to project</button>)}
      {data.canEdit && <button className="ops-primary" type="submit" form={formId} disabled={locked}>Save pitch draft</button>}
    </div>}
    <ConfirmDialog id="idea-reload-confirm" open={reloadConfirmOpen} tone="default" title="Reload the saved version?"
      message="Your unsaved changes in this pitch will be discarded and the last saved version will be shown."
      confirmLabel="Discard and reload" cancelLabel="Keep editing" onCancel={() => setReloadConfirmOpen(false)} onConfirm={() => { setReloadConfirmOpen(false); setReload((value) => value + 1); }} />
  </section>;
}

export function formatRecordTime(value: string | undefined, withTime = true) {
  if (!value) return '';
  // PostgreSQL text timestamps use "YYYY-MM-DD HH:MM:SS+00"; normalise them for Date parsing.
  const date = new Date(value.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00'));
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-GB', withTime
    ? { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }
    : { day: 'numeric', month: 'short', timeZone: 'Europe/London' }).format(date);
}

type ReviewReport = SavedIdeaReview['report'];
const sentence = (value: string) => value.charAt(0).toUpperCase() + value.slice(1).replaceAll('_', ' ').toLowerCase();
const blockLabel = (field: string) => ideaFields.find(item => item.key === field)?.label || 'Track';
export function reviewHeadline(report: ReviewReport) {
  if (isLegacyIdeaReview(report)) return `Earlier eight-criteria review · ${report.recommendation.replaceAll('_', ' ')}`;
  const open = report.blocks.filter(item => item.status === 'missing' || item.status === 'needs_work').length;
  return open ? `${open} of ${report.blocks.length} blocks need work` : 'All blocks adequate or better';
}
function Quotes({ evidence, own }: { evidence: Array<{ field: string; quote: string }>; own?: string }) {
  return evidence.map((item, index) => <blockquote key={index}>{item.field === own ? '' : `${blockLabel(item.field)}: `}{item.quote}</blockquote>);
}
export function IdeaReviewReport({ report }: { report: ReviewReport }) {
  if (isLegacyIdeaReview(report)) return <>
    <p className="idea-review-summary">{report.summary}</p>
    <ul className="idea-advice-list">{report.checks.map((check) => <li key={check.field}>
      <span className="idea-advice-row"><strong>{sentence(check.field.replaceAll(/([A-Z])/g, ' $1'))}</strong><span className={`idea-advice-status is-${check.status}`}>{sentence(check.status)}</span></span>
      <p>{check.assessment}</p>
      <Quotes evidence={check.evidence} />
      <p className="idea-advice-improve">Improve: {check.improvement}</p>
    </li>)}</ul>
    <h4>Next tests</h4><ol>{report.nextSteps.map((step, index) => <li key={index}>{step}</li>)}</ol>
  </>;
  const order = ideaFields.map(item => item.key as string);
  return <>
    <p className="idea-review-summary">{report.summary}</p>
    <ul className="idea-advice-list">{[...report.blocks].sort((a, b) => order.indexOf(a.block) - order.indexOf(b.block)).map((item) => <li key={item.block}>
      <span className="idea-advice-row"><strong>{blockLabel(item.block)}</strong><span className={`idea-advice-status is-${item.status}`}>{ideaBlockStatusLabels[item.status]}</span></span>
      {item.focus.length > 0 && <small className="idea-advice-focus">{item.focus.join(' · ')}</small>}
      <p>{item.gap}</p>
      <Quotes evidence={item.evidence} own={item.block} />
      <p className="idea-advice-improve">Improve: {item.improvement}</p>
    </li>)}</ul>
    <h4>Discussant questions</h4>
    <ul className="idea-advice-list">{(['delta', 'poc'] as const).map((key) => <li key={key}>
      <span className="idea-advice-row"><strong>{ideaDiscussantQuestions[key]}</strong><span className={`idea-advice-status is-${report.discussant[key].status}`}>{ideaDiscussantStatusLabels[report.discussant[key].status]}</span></span>
      <p>{report.discussant[key].answer}</p>
      <Quotes evidence={report.discussant[key].evidence} />
    </li>)}</ul>
    <h4>Next steps</h4><ol>{report.nextSteps.map((step, index) => <li key={index}>{step}</li>)}</ol>
  </>;
}
