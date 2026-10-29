'use client';

import { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { checklistDraftKey, readChecklistDraft, removeChecklistDraft, writeChecklistDraft } from './checklist-drafts';
import { requestJson } from './client-request';
import { IdeaPitchEditor, formatRecordTime } from './idea-pitch-editor';
import { ConfirmDialog } from './confirm-dialog';
import type { IdeaPitch } from '../src/mastra/projects/idea-check';

const railGroups = [
  { access: 'owner', label: 'Your pitches' },
  { access: 'pi', label: 'Other proposers' },
  { access: 'shared', label: 'Shared with you · Read only' },
] as const;

const statusLabels: Record<string, string> = { draft: 'Awaiting human decision', revise: 'Revise', proceed: 'Proceed', stop: 'Stop', project: 'Project created' };

function pitchMeta(pitch: IdeaPitch) {
  const state = pitch.projectId
    ? 'Converted to project'
    : pitch.outcome
      ? `Decision: ${pitch.outcome.charAt(0).toUpperCase()}${pitch.outcome.slice(1)}`
      : pitch.version ? `Draft v${pitch.version}` : 'Draft';
  return pitch.updatedAt ? `${state} · ${formatRecordTime(pitch.updatedAt, false)}` : state;
}

export function IdeaPitches({ userId, onProjectCreated }: { userId: string; onProjectCreated: () => Promise<void> }) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [pitches, setPitches] = useState<IdeaPitch[] | null>(null);
  const selectionKey = checklistDraftKey(userId, 'idea:selected');
  const [selected, setSelected] = useState(() => readChecklistDraft(selectionKey, ''));
  const [displayed, setDisplayed] = useState(selected);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [scope, setScope] = useState('personal');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [newDraft, setNewDraft] = useState(0);
  const [editorState, setEditorState] = useState({ dirty: false, busy: false });
  // Pitch id waiting for the user to confirm discarding unsaved changes (null = no pending switch).
  const [pendingSwitch, setPendingSwitch] = useState<string | null>(null);
  // A new pitch keeps its draft under 'idea:new' until reopened by id, so clear both keys.
  function discardDrafts() {
    for (const id of new Set([selected, displayed])) removeChecklistDraft(checklistDraftKey(userId, 'idea:' + (id || 'new')));
  }
  function openPitch(id: string) {
    if (editorState.busy) return;
    if (editorState.dirty) { setPendingSwitch(id); return; }
    switchTo(id);
  }
  function switchTo(id: string) {
    setPendingSwitch(null);
    discardDrafts();
    writeChecklistDraft(selectionKey, id);
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
    {error && <p role="alert" className="ops-notice error idea-page-alert">{error} <button className="ops-secondary" type="button" onClick={() => { setError(''); void load().catch((caught) => setError(caught.message)); }}>Retry</button></p>}
    {status && <p role="status" className="form-message idea-page-status">{status}</p>}
    {scope === 'all' && <section className="idea-pi-overview" aria-label="PI and administrator pitch overview">
      <div className="idea-pi-head">
        <div className="idea-pi-intro"><h2>PI / Admin overview · All pitches</h2><p>See everyone’s saved pitches. Open a pitch to review its full version history, record a decision or manage sharing.</p></div>
        <div className="idea-export-controls"><label>Find a pitch<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Title or proposer username" /></label>
        <label>Pitch status<select value={filter} onChange={event => setFilter(event.target.value)}><option value="all">All statuses</option><option value="draft">Awaiting human decision</option><option value="revise">Revise</option><option value="proceed">Proceed</option><option value="stop">Stop</option><option value="project">Project created</option></select></label></div>
      </div>
      {matchingPitches.length > 0 && <div className="idea-pi-list"><table className="idea-pi-table">
        <thead><tr><th scope="col">Pitch</th><th scope="col">Proposer</th><th scope="col">Status</th><th scope="col" className="is-version">Version</th><th scope="col" className="is-updated">Updated</th></tr></thead>
        <tbody>{matchingPitches.map(pitch => {
          const state = pitch.projectId ? 'project' : pitch.outcome || 'draft';
          return <tr key={pitch.id} className={pitch.id === displayed ? 'active' : undefined}>
            <td><button type="button" className="idea-pi-open" disabled={editorState.busy} onClick={() => openPitch(pitch.id)}>{pitch.title}</button></td>
            <td>@{pitch.ownerUsername}</td>
            <td><span className={`idea-pi-status is-${state}`}>{statusLabels[state] || state}</span></td>
            <td className="is-version vs-mono">v{pitch.version || 0}</td>
            <td className="is-updated vs-mono">{formatRecordTime(pitch.updatedAt, false)}</td>
          </tr>;
        })}</tbody>
      </table></div>}
      {pitches && matchingPitches.length === 0 && <p className="idea-pi-empty">{pitches.length ? 'No pitches match this search.' : 'No saved pitches yet.'}</p>}
    </section>}
    <div className="idea-workspace">
      <aside className="idea-pitch-toolbar" aria-label="Pitch list">
        <button className="ops-secondary idea-new-pitch" type="button" disabled={editorState.busy} onClick={() => openPitch('')}><Plus aria-hidden="true" />New pitch</button>
        <label className="idea-rail-select">Saved pitches <select aria-label="Saved pitches" value={displayed} disabled={editorState.busy} onChange={(event) => openPitch(event.target.value)}>
          <option value="">New pitch</option>
          {['owner', 'pi', 'shared'].map(access => <optgroup key={access} label={access === 'shared' ? 'Shared with me · Read only' : access === 'pi' ? 'Other proposers · PI / Admin access' : 'My pitches'}>{(pitches || []).filter(pitch => pitch.access === access).map(pitch => <option key={pitch.id} value={pitch.id}>{pitch.title} · @{pitch.ownerUsername} · {pitch.projectId ? 'Project created' : pitch.outcome || 'Draft'}</option>)}</optgroup>)}
        </select></label>
        {pitches === null && <span className="idea-rail-note" role="status">{error ? 'Saved pitches unavailable.' : 'Loading saved pitches…'}</span>}
        {railGroups.map(group => {
          const items = (pitches || []).filter(pitch => pitch.access === group.access);
          return items.length > 0 && <div className="idea-rail-group" key={group.access}>
            <h2 className="vs-caps">{group.label}</h2>
            <ul>{items.map(pitch => <li key={pitch.id}>
              <button type="button" className={`idea-rail-item${pitch.id === displayed ? ' active' : ''}`} aria-current={pitch.id === displayed ? 'true' : undefined} disabled={editorState.busy} onClick={() => { if (pitch.id !== displayed) openPitch(pitch.id); }}>
                <span>{pitch.title}</span>
                <small>{group.access !== 'owner' && `@${pitch.ownerUsername} · `}{pitchMeta(pitch)}</small>
              </button>
            </li>)}</ul>
          </div>;
        })}
        <p className="idea-rail-note">An empty editor does not create a pitch. A pitch is stored only when you save it.</p>
      </aside>
      <div ref={editorRef} className="idea-editor-host"><IdeaPitchEditor userId={userId} key={`${selected}-${newDraft}`} pitchId={selected} onProjectCreated={onProjectCreated} onStateChanged={setEditorState} onDeleted={async () => { discardDrafts(); writeChecklistDraft(selectionKey, ''); setPitches(current => current?.filter(pitch => pitch.id !== displayed) || []); setSelected(''); setDisplayed(''); setNewDraft(value => value + 1); setStatus('Pitch deleted.'); try { await load(); } catch { setError('Pitch deleted, but the saved list could not refresh. Retry.'); } }} onChanged={async (id) => { writeChecklistDraft(selectionKey, id); setStatus(''); setDisplayed(id); await load(); }} /></div>
    </div>
    <ConfirmDialog id="idea-switch-confirm" open={pendingSwitch !== null} tone="default" title="Discard unsaved changes?"
      message="This pitch has changes that are not saved. Switching will discard them; the last saved version is kept."
      confirmLabel="Discard and switch" cancelLabel="Keep editing" onCancel={() => setPendingSwitch(null)} onConfirm={() => switchTo(pendingSwitch ?? '')} />
  </section>;
}
