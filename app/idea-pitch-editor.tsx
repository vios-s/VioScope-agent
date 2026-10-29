'use client';

import { Fragment, useEffect, useId, useRef, useState } from 'react';
import { IdeaPitchSharing } from './idea-pitch-sharing';
import { checklistDraftKey, readChecklistDraft, writeChecklistDraft, removeChecklistDraft } from './checklist-drafts';
import { requestJson } from './client-request';
import { checkIdea, ideaDraftSchema, ideaFields, defaultPitchExportFormat, type PitchExportFormat, type IdeaCheckPayload, type IdeaDecision, type IdeaDraft, type IdeaSource } from '../src/mastra/projects/idea-check';

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
  const url = `/api/idea-pitches/${encodeURIComponent(resolvedId.current)}`;
  async function ensurePitch() {
    if (!resolvedId.current) {
      if (!title.trim()) throw new Error('Enter a pitch title before importing or saving.');
      const result = await requestJson<{ id: string }>('/api/idea-pitches', 'Could not create pitch.', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: title.trim() }) });
      resolvedId.current = result.id;
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
      setPreview(await requestJson<{ draft: IdeaDraft; source: IdeaSource }>(`${target}/import`, 'Could not organize the document.', { method: 'POST', body: form }));
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
  return <section className="project-idea-check" aria-busy={busy}>
    <p>Draft text is kept in this browser tab until sign-out. Use Save pitch draft to save a version. Select uploaded files again after refreshing.</p>
    {conflictingDraft && <section role="status"><p>Your local draft is retained separately because the saved version changed. Choose which text to continue with before saving.</p>
      <button type="button" className="ops-secondary" onClick={() => { setTitle(conflictingDraft.title); setDraft(conflictingDraft.draft); setSource(conflictingDraft.source); setPasted(conflictingDraft.pasted); setConflictingDraft(null); }}>Restore local draft</button>
      <button type="button" className="ops-secondary" onClick={() => setConflictingDraft(null)}>Use saved version</button>
    </section>}
    {resolvedId.current && data && <div className="idea-record-header">
      <h3>{data.pitch.id ? data.pitch.title : 'Unsaved pitch'}</h3>
      {data.canEdit && <button type="button" className="ops-secondary" disabled={busy || Boolean(conflictingDraft)} onClick={() => { setDeleteOpen(true); setDeleteConfirmed(false); }}>Delete pitch</button>}
    </div>}
    {deleteOpen && <section className="idea-delete-confirm" aria-labelledby={`${prefix}-delete-heading`}>
      <h4 id={`${prefix}-delete-heading`}>Delete this pitch?</h4>
      <p>This permanently removes “{data?.pitch.id ? data.pitch.title : title || 'Untitled idea'}”, all its versions, source text and AI reviews. It cannot be undone.</p>
      <label className="idea-confirm"><input type="checkbox" checked={deleteConfirmed} disabled={busy || Boolean(conflictingDraft)} onChange={(event) => setDeleteConfirmed(event.target.checked)} /> I understand this pitch and its history will be deleted.</label>
      <div><button type="button" className="ops-secondary" disabled={busy || Boolean(conflictingDraft)} onClick={() => setDeleteOpen(false)}>Cancel</button> <button type="button" className="ops-secondary" disabled={busy || !deleteConfirmed} onClick={() => void removePitch()}>Permanently delete pitch</button></div>
    </section>}
    {error && <p role="alert">{error} <button type="button" className="ops-secondary" disabled={busy || Boolean(conflictingDraft)} onClick={() => { if (!dirty || window.confirm('Discard unsaved changes and reload the saved version?')) setReload((value) => value + 1); }}>Reload saved version</button></p>}
    {status && <p role="status">{status}</p>}
    {!data ? <p role="status">{error ? 'Idea check unavailable.' : 'Loading idea check…'}</p> : <>
      <p className="idea-save-state">{data.current ? `Saved v${data.current.version} by @${data.current.by} · ${data.current.at}` : 'Start with any block. Save whenever you are ready.'}</p>
      {data.current && <p><strong>Current decision: {data.current?.decision?.outcome || 'Pending human review'}</strong>{dirty ? ' · Unsaved changes' : ''}</p>}
      {data.current?.decision && <><p>Reason / evidence: {data.current.decision.rationale}</p><p>Next milestone or closure: {data.current.decision.nextMilestone}</p></>}
      {data.canManage && data.current?.decision?.outcome === 'proceed' && <section className="idea-export" aria-label="Download approved pitch">
        <h4>Approved pitch document</h4>
        <p>Download the confirmed title, pitch sections and human decision. Old drafts, source text and AI review history are excluded.</p>
        {data.current?.decision?.outcome === 'proceed' && !dirty ? <div className="idea-export-controls">
          <label>Download format <select value={exportFormat} disabled={busy || Boolean(conflictingDraft)} onChange={(event) => setExportFormat(event.target.value as PitchExportFormat)}>
            <option value="docx">Word (.docx)</option><option value="pdf">PDF (.pdf)</option><option value="md">Markdown (.md)</option><option value="txt">Plain text (.txt)</option>
          </select></label>
          <button type="button" className="ops-secondary" disabled={busy || Boolean(conflictingDraft)} onClick={() => void downloadPitch()}>Download approved pitch</button>
        </div> : <p>Available after saving and confirming a human Proceed decision. AI feedback alone is not approval.</p>}
        {data.current?.decision?.outcome === 'proceed' && <p>The original file format is selected when supported. Exports use a clean document layout; PPTX input defaults to Word.</p>}
      </section>}
      {!data.canManage && <p role="status">Shared with you · Read only. You can see the latest saved pitch; private history, source documents and AI reviews are not shared.</p>}
      <div className="idea-compose-layout"><div className="idea-writing-sheet">
      {source && <details><summary>Source text: {source.name}</summary><pre className="idea-source-text">{source.text}</pre></details>}
      <form onSubmit={(event) => { event.preventDefault(); void save('save'); }}>
        <fieldset disabled={busy || Boolean(conflictingDraft)} className="idea-fields"><legend>Idea and validation plan</legend>
          <label className="idea-optional-title" htmlFor={`${prefix}-title`}>Pitch title
            <input id={`${prefix}-title`} readOnly={!data.canEdit} required={data.canEdit} maxLength={200} value={title} onChange={(event) => { setTitle(event.target.value); setConfirmed(false); setCreateConfirmed(false); }} placeholder="e.g. Smaller models for low-cost research" />
          </label>
          <p className="idea-section-title">Lead: {data.pitch.ownerUsername ? `@${data.pitch.ownerUsername}` : 'You'}</p>
          <label>Track
            <span>Choose the intended project track.</span>
            <select value={draft.track} disabled={!data.canEdit} onChange={event => { setDraft({ ...draft, track: event.target.value as '' | 'A' | 'B' }); setConfirmed(false); setCreateConfirmed(false); }}>
              <option value="">Select a track</option><option value="A">Track A</option><option value="B">Track B</option>
            </select>
          </label>
          {ideaFields.map((field, index) => <Fragment key={field.key}>
            {(index === 0 || ideaFields[index - 1].section !== field.section) && <h3 className="idea-section-title">{field.section}</h3>}
            <label htmlFor={`${prefix}-${field.key}`}>{field.label}
              <span id={`${prefix}-${field.key}-hint`}>{field.hint}</span>
              <textarea id={`${prefix}-${field.key}`} readOnly={!data.canEdit} aria-describedby={`${prefix}-${field.key}-hint`} placeholder={field.hint} rows={3} maxLength={4000}
                value={draft[field.key] || ''} onChange={(event) => { setDraft({ ...draft, [field.key]: event.target.value }); setConfirmed(false); setCreateConfirmed(false); }} />
            </label>
          </Fragment>)}

          {data.canEdit && <button className="ops-primary" type="submit">Save pitch draft</button>}
        </fieldset>
      </form>
      </div><aside className="idea-review-rail" aria-label="Pitch preparation">
      {data.canManage && data.pitch.id && <IdeaPitchSharing pitchId={data.pitch.id} owner={data.pitch.ownerUsername} collaborators={data.collaborators} disabled={busy || Boolean(conflictingDraft)} onBusyChanged={setSharingBusy} onChanged={async () => {
        const payload = await requestJson<IdeaCheckPayload>(url, 'Sharing changed, but could not refresh the collaborator list.');
        // Sharing must not advance the version used by an unsaved draft.
        setData(current => current ? { ...current, collaborators: payload.collaborators } : current);
      }} />}
      {data.canEdit && <section className="idea-import"><h4>Bring your notes</h4>
        <p id={`${prefix}-import-hint`}>Upload TXT, MD, DOCX, text-based PDF or PPTX (up to 5 MB), or paste up to 32,000 characters. Check extracted text for missing images or equations.</p>
        <fieldset disabled={busy || Boolean(conflictingDraft)} className="idea-source-inputs"><legend>Upload or paste</legend>
          <label>Upload pitch document <input type="file" aria-describedby={`${prefix}-import-hint`} accept=".txt,.md,.docx,.pdf,.pptx" onChange={(event) => { setUpload(event.target.files?.[0] || null); setPreview(null); }} /></label>
          <label>Or paste the full pitch <textarea aria-describedby={`${prefix}-import-hint`} rows={3} maxLength={32000} value={pasted} onChange={(event) => { setPasted(event.target.value); setPreview(null); }} /></label>
          <button type="button" className="ops-secondary" disabled={(!upload && !pasted.trim()) || Boolean(upload && pasted.trim())} onClick={() => void prepareImport()}>Prepare block preview</button>
          {upload && pasted.trim() && <p>Clear the file or the pasted text to choose one source.</p>}
        </fieldset>
        {preview && <div><h4>Review extracted blocks before applying</h4>
          <p>Only exact excerpts are placed into blocks. Missing information stays empty. Applying replaces the current blocks but does not save them.</p>
          <details><summary>Extracted source: {preview.source.name}</summary><pre className="idea-source-text">{preview.source.text}</pre></details>
          <dl><div><dt>Track</dt><dd>{preview.draft.track || 'Missing — fill in yourself'}</dd></div>{ideaFields.map((field) => <div key={field.key}><dt>{field.label}</dt><dd>{preview.draft[field.key] || 'Missing — fill in yourself'}</dd></div>)}</dl>
          <button type="button" className="ops-secondary" disabled={busy || Boolean(conflictingDraft)} onClick={() => { setDraft(preview.draft); setSource(preview.source); setPreview(null); setConfirmed(false); setCreateConfirmed(false); setStatus('Preview applied to unsaved blocks. Review and save the draft.'); }}>Replace blocks with this preview</button>
        </div>}
      </section>}
      <section className="idea-completeness"><h4>Ready for discussion?</h4>
      <p>{missing.length ? `${missing.length} sections still need information. You can save an incomplete draft.` : 'All sections contain text. A person must still judge the evidence and feasibility.'}</p>
      <ul className="idea-check-list">{checks.map((item) => <li key={item.key}><span className={item.present ? 'is-recorded' : 'is-missing'}>{item.present ? 'Recorded' : 'Missing'}</span>: {item.label}</li>)}</ul></section>
      </aside></div>
      <section className="idea-followup" aria-label="AI feedback and next steps">
      {data.canManage && <section className="idea-review-results">
        <h4>AI feedback</h4>
        <p>Get suggestions on evidence and feasibility. AI gives advice; your PI discussion guides the decision.</p>
        {data.canEdit && <button type="button" className="ops-secondary" disabled={busy || dirty || !data.current} onClick={() => void runReview()}>Check pitch with AI</button>}
        {data.canEdit && (dirty || !data.current) && <p>Save the draft before checking it.</p>}
        {busy && <p role="status">Working…</p>}
        {data.reviews.map((review) => <details key={review.id} open={review === data.reviews[0]}>
          <summary>Review of v{review.pitchVersion} · {review.report.recommendation.replaceAll('_', ' ')}{JSON.stringify(data.history.find((revision) => revision.version === review.pitchVersion)?.draft) !== JSON.stringify(data.current?.draft) ? ' · Draft changed — review again' : ''}</summary>
          <p>{review.report.summary}</p>
          <ul>{review.report.checks.map((check) => <li key={check.field}><strong>{ideaFields.find((field) => field.key === check.field)?.label}: {check.status.replaceAll('_', ' ')}</strong>
            <p>{check.assessment}</p>
            {check.evidence.map((evidence, index) => <blockquote key={index}>{evidence.field}: {evidence.quote}</blockquote>)}
            <p>Improve: {check.improvement}</p>
          </li>)}</ul>
          <h4>Next tests</h4><ol>{review.report.nextSteps.map((step, index) => <li key={index}>{step}</li>)}</ol>
          <small>@{review.by} · {review.at} · {review.model} · Rules {review.rulesHash.slice(0, 12)}</small>
        </details>)}
      </section>}
      {data.canEdit && <form onSubmit={(event) => { event.preventDefault(); void save('decide'); }}>
        <fieldset disabled={busy || Boolean(conflictingDraft) || !data.current || dirty}><legend>Record the human decision</legend>
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
        {(!data.current || dirty) && <p>Save your draft before recording a decision.</p>}
      </form>}
      {data.canManage && !data.canEdit && <p>This pitch has become a project. Its original approval record is read only and cannot be deleted.</p>}
      {data.canManage && (data.pitch.projectId ? <p role="status">Created project: {data.pitch.title}. Find it under Projects.</p> : data.current?.decision?.outcome === 'proceed' && !dirty && <form onSubmit={(event) => { event.preventDefault(); void save('create_project'); }}>
        <fieldset disabled={busy || Boolean(conflictingDraft)}><legend>Create a project from this pitch</legend>
          <p>The approved question, contribution, validation plan and risks become the initial project research profile. The original approved pitch remains unchanged.</p>
          <p>Approved next milestone: {data.current.decision.nextMilestone}</p>
          <label>Project track<select value={setup.track} onChange={event=>{setSetup({...setup,track:event.target.value});setCreateConfirmed(false);}}><option value="A">Track A — Flagship</option><option value="B">Track B — Momentum</option></select></label>
          <label>Project PI username<input value={setup.piUsername} onChange={event=>{setSetup({...setup,piUsername:event.target.value});setCreateConfirmed(false);}} placeholder="Optional active PI account" /></label>
          <label>PDRA reviewer username<input value={setup.pdraUsername} onChange={event=>{setSetup({...setup,pdraUsername:event.target.value});setCreateConfirmed(false);}} placeholder="Optional active reviewer account" /></label>
          <label>Project collaborator usernames<input value={setup.collaborators} onChange={event=>{setSetup({...setup,collaborators:event.target.value});setCreateConfirmed(false);}} placeholder="Comma-separated account usernames" /></label>
          <p>Confirm project access separately. Pitch viewers and the approving PI are not assigned automatically.</p>

          <label>First next action <textarea required maxLength={240} rows={2} value={initialAction} onChange={(event) => { setInitialAction(event.target.value); setCreateConfirmed(false); }} /></label>
          <label>Action deadline <input required type="date" value={actionDueDate} onChange={(event) => { setActionDueDate(event.target.value); setCreateConfirmed(false); }} /></label>
          <p>@{data.pitch.ownerUsername} is responsible for this action. Manage further tasks in Projects. Attach the project when submitting a theme meeting update.</p>
          <label className="idea-confirm"><input type="checkbox" required checked={createConfirmed} onChange={(event) => setCreateConfirmed(event.target.checked)} /> I confirm this approved pitch should now become a project.</label>
          <button type="submit" className="ops-primary" disabled={!createConfirmed}>Create project</button>
        </fieldset>
      </form>)}
      {data.canManage && <details className="idea-history" open><summary>History (all revisions)</summary>
        {!data.history.length && <p>Your saved versions will appear here.</p>}
        {data.history.map((revision) => <details key={revision.version}><summary>v{revision.version} · @{revision.by} · {revision.at} · {revision.decision?.outcome || 'Draft — review pending'}</summary>
          {revision.title && <p>Title: {revision.title}</p>}
          {revision.source && <details><summary>Source: {revision.source.name}</summary><pre className="idea-source-text">{revision.source.text}</pre></details>}
          {revision.decision && <><p>{revision.decision.rationale}</p><p>{revision.decision.nextMilestone}</p></>}
          <dl>{ideaFields.map((field) => <div key={field.key}><dt>{field.label}</dt><dd>{revision.draft[field.key] || 'Not recorded'}</dd></div>)}</dl>
        </details>)}
      </details>}
      </section>
    </>}
  </section>;
}
