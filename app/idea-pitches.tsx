'use client';

import { useEffect, useRef, useState } from 'react';
import { requestJson } from './client-request';
import { IdeaPitchEditor } from './idea-pitch-editor';
import type { IdeaPitch } from '../src/mastra/projects/idea-check';

export function IdeaPitches({ onProjectCreated }: { onProjectCreated: () => Promise<void> }) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [pitches, setPitches] = useState<IdeaPitch[] | null>(null);
  const [selected, setSelected] = useState('');
  const [displayed, setDisplayed] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [scope, setScope] = useState('personal');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [newDraft, setNewDraft] = useState(0);
  const [editorState, setEditorState] = useState({ dirty: false, busy: false });
  function openPitch(id: string) {
    if (editorState.busy || (editorState.dirty && !window.confirm('Discard unsaved changes and switch pitches?'))) return;
    setStatus(''); setSelected(id); setDisplayed(id); setNewDraft(value => value + 1);
  }
  useEffect(() => { if (scope === 'all' && newDraft > 0) editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, [newDraft, scope]);
  async function load() {
    const payload = await requestJson<{ pitches: IdeaPitch[]; scope: string }>('/api/idea-pitches', 'Could not load idea pitches.');
    setPitches(payload.pitches); setScope(payload.scope);
  }
  useEffect(() => {
    let active = true;
    void requestJson<{ pitches: IdeaPitch[]; scope: string }>('/api/idea-pitches', 'Could not load idea pitches.')
      .then((data) => { if (active) { setPitches(data.pitches); setScope(data.scope); } })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : 'Could not load.'); });
    return () => { active = false; };
  }, []);
  const matchingPitches = (pitches || []).filter(pitch => `${pitch.title} ${pitch.ownerUsername}`.toLowerCase().includes(search.toLowerCase()) && (filter === 'all' || (pitch.projectId ? 'project' : pitch.outcome || 'draft') === filter));
  return <section className="idea-pitches-panel">
    <header className="idea-workspace-header">
      <div><h1>Idea Pitch</h1><p>Shape your research question, check the evidence, then agree the next step with your PI.</p></div>
      <span className="idea-privacy">Private unless shared</span>
    </header>
    {error && <p role="alert">{error} <button className="ops-secondary" type="button" onClick={() => { setError(''); void load().catch((caught) => setError(caught.message)); }}>Retry</button></p>}
    {status && <p role="status">{status}</p>}
    {scope === 'all' && <section className="idea-pi-overview" aria-label="PI and administrator pitch overview">
      <h2>PI / Admin overview · All pitches</h2><p>See everyone’s saved pitches. Open a pitch to review its full version history, record a decision or manage sharing.</p>
      <div className="idea-export-controls"><label>Find a pitch<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Title or proposer username" /></label>
      <label>Pitch status<select value={filter} onChange={event => setFilter(event.target.value)}><option value="all">All statuses</option><option value="draft">Awaiting human decision</option><option value="revise">Revise</option><option value="proceed">Proceed</option><option value="stop">Stop</option><option value="project">Project created</option></select></label></div>
      <div className="idea-pi-list">{matchingPitches.map(pitch => <article key={pitch.id}>
        <button type="button" className="ops-secondary" disabled={editorState.busy} onClick={() => openPitch(pitch.id)}>{pitch.title}</button>
        <span>@{pitch.ownerUsername}</span><span>{pitch.projectId ? 'Project created' : pitch.outcome || 'Awaiting human decision'} · v{pitch.version || 0}</span>
      </article>)}</div>
      {pitches && matchingPitches.length === 0 && <p>{pitches.length ? 'No pitches match this search.' : 'No saved pitches yet.'}</p>}
    </section>}
    <div className="idea-pitch-toolbar">
      <label>Saved pitches <select aria-label="Saved pitches" value={displayed} disabled={editorState.busy} onChange={(event) => openPitch(event.target.value)}>
        <option value="">New pitch</option>
        {['owner', 'pi', 'shared'].map(access => <optgroup key={access} label={access === 'shared' ? 'Shared with me · Read only' : access === 'pi' ? 'Other proposers · PI / Admin access' : 'My pitches'}>{(pitches || []).filter(pitch => pitch.access === access).map(pitch => <option key={pitch.id} value={pitch.id}>{pitch.title} · @{pitch.ownerUsername} · {pitch.projectId ? 'Project created' : pitch.outcome || 'Draft'}</option>)}</optgroup>)}
      </select></label>
      <button className="ops-secondary" type="button" disabled={editorState.busy} onClick={() => openPitch('')}>New pitch</button>
      {pitches === null && <span role="status">{error ? 'Saved pitches unavailable.' : 'Loading saved pitches…'}</span>}
    </div>
    <div ref={editorRef}><IdeaPitchEditor key={`${selected}-${newDraft}`} pitchId={selected} onProjectCreated={onProjectCreated} onStateChanged={setEditorState} onDeleted={async () => { setPitches(current => current?.filter(pitch => pitch.id !== displayed) || []); setSelected(''); setDisplayed(''); setNewDraft(value => value + 1); setStatus('Pitch deleted.'); try { await load(); } catch { setError('Pitch deleted, but the saved list could not refresh. Retry.'); } }} onChanged={async (id) => { setStatus(''); setDisplayed(id); await load(); }} /></div>
  </section>;
}
