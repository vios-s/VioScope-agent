'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Plus } from 'lucide-react';
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

const statusLabels: Record<string, string> = { draft: 'Awaiting decision', revise: 'Revise', proceed: 'Proceed', stop: 'Stop', project: 'Project created' };
const pitchState = (pitch: IdeaPitch) => pitch.projectId ? 'project' : pitch.outcome || 'draft';

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
  // Phones and tablets stack the rail above the editor: collapse the list after a choice and bring the editor into view.
  const [listOpen, setListOpen] = useState(false);
  useEffect(() => {
    setListOpen(false);
    if (newDraft > 0 && (editorRef.current?.getBoundingClientRect().top ?? 0) < 0) editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [newDraft]);
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
  const matchingPitches = (pitches || []).filter(pitch => `${pitch.title} @${pitch.ownerUsername}`.toLowerCase().includes(search.trim().toLowerCase()) && (filter === 'all' || pitchState(pitch) === filter));
  const current = pitches?.find(pitch => pitch.id === displayed);
  return <section className="idea-pitches-panel">
    {error && <p role="alert" className="ops-notice error idea-page-alert">{error} <button className="ops-secondary" type="button" onClick={() => { setError(''); void load().catch((caught) => setError(caught.message)); }}>Retry</button></p>}
    {status && <p role="status" className="form-message idea-page-status">{status}</p>}
    <div className="idea-workspace">
      <aside className="idea-pitch-toolbar" aria-label="Pitch list">
        <button className="ops-secondary idea-new-pitch" type="button" disabled={editorState.busy} onClick={() => openPitch('')}><Plus aria-hidden="true" />New pitch</button>
        <button type="button" className="idea-rail-toggle" aria-expanded={listOpen} aria-controls="idea-rail-list" onClick={() => setListOpen(open => !open)}>
          <span>{listOpen ? 'Hide saved pitches' : `Saved pitches${pitches ? ` (${pitches.length})` : ''}`}</span>
          {!listOpen && <small>{current ? `Open: ${current.title}` : 'Open: new pitch'}</small>}
          <ChevronDown aria-hidden="true" />
        </button>
        <div id="idea-rail-list" className="idea-rail-list" data-open={listOpen}>
          {(pitches?.length || 0) > 0 && <div className="idea-rail-filters">
            <label>Find a pitch<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Title or @username" /></label>
            {(scope === 'all' || (pitches?.length || 0) > 8) && <label>Pitch status<select value={filter} onChange={event => setFilter(event.target.value)}><option value="all">All statuses</option><option value="draft">Awaiting decision</option><option value="revise">Revise</option><option value="proceed">Proceed</option><option value="stop">Stop</option><option value="project">Project created</option></select></label>}
          </div>}
          {pitches === null && <span className="idea-rail-note" role="status">{error ? 'Saved pitches unavailable.' : 'Loading saved pitches…'}</span>}
          {pitches && matchingPitches.length === 0 && <p className="idea-rail-note" role="status">{pitches.length ? 'No pitches match this search.' : 'No saved pitches yet.'}</p>}
          {railGroups.map(group => {
            const items = matchingPitches.filter(pitch => pitch.access === group.access);
            return items.length > 0 && <div className="idea-rail-group" key={group.access}>
              <h2 className="vs-caps">{group.label}</h2>
              <ul>{items.map(pitch => <li key={pitch.id}>
                <button type="button" data-pitch-id={pitch.id} className={`idea-rail-item${pitch.id === displayed ? ' active' : ''}`} aria-current={pitch.id === displayed ? 'true' : undefined} disabled={editorState.busy} onClick={() => { if (pitch.id !== displayed) openPitch(pitch.id); else setListOpen(false); }}>
                  <span>{pitch.title}</span>
                  <small>{group.access !== 'owner' && <>@{pitch.ownerUsername} · </>}<span className={`idea-rail-status is-${pitchState(pitch)}`}>{statusLabels[pitchState(pitch)]}</span>{pitch.version ? <> · <span className="vs-mono">v{pitch.version}</span></> : null}{pitch.updatedAt ? ` · ${formatRecordTime(pitch.updatedAt, false)}` : ''}</small>
                </button>
              </li>)}</ul>
            </div>;
          })}
        </div>
        <p className="idea-rail-note">An empty editor does not create a pitch. A pitch is stored only when you save it.</p>
      </aside>
      <div ref={editorRef} className="idea-editor-host"><IdeaPitchEditor userId={userId} key={`${selected}-${newDraft}`} pitchId={selected} onProjectCreated={onProjectCreated} onStateChanged={setEditorState} onDeleted={async () => { discardDrafts(); writeChecklistDraft(selectionKey, ''); setPitches(current => current?.filter(pitch => pitch.id !== displayed) || []); setSelected(''); setDisplayed(''); setNewDraft(value => value + 1); setStatus('Pitch deleted.'); try { await load(); } catch { setError('Pitch deleted, but the saved list could not refresh. Retry.'); } }} onChanged={async (id) => { writeChecklistDraft(selectionKey, id); setStatus(''); setDisplayed(id); await load(); }} /></div>
    </div>
    <ConfirmDialog id="idea-switch-confirm" open={pendingSwitch !== null} tone="default" title="Discard unsaved changes?"
      message="This pitch has changes that are not saved. Switching will discard them; the last saved version is kept."
      confirmLabel="Discard and switch" cancelLabel="Keep editing" onCancel={() => setPendingSwitch(null)} onConfirm={() => switchTo(pendingSwitch ?? '')} />
  </section>;
}
