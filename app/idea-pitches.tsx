'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Plus } from 'lucide-react';
import { checklistDraftKey, readChecklistDraft, removeChecklistDraft, writeChecklistDraft } from './checklist-drafts';
import { requestJson } from './client-request';
import { IdeaPitchEditor } from './idea-pitch-editor';
import { formatShortDay } from './format';
import { ConfirmDialog } from './confirm-dialog';
import { ideaOutcomeLabels, type IdeaPitch } from '../src/mastra/projects/idea-check';

const railGroups = [
  { access: 'owner', label: 'Your pitches' },
  { access: 'pi', label: 'Other proposers' },
  { access: 'shared', label: 'Shared with you · Read only' },
] as const;

const statusLabels: Record<string, string> = { unsaved: 'Not saved yet', draft: 'Awaiting decision', ...ideaOutcomeLabels, project: 'Project created' };
const statusTone: Record<string, string> = { unsaved: 'muted', draft: 'muted', revise: 'warn', proceed: 'ok', stop: 'danger', project: 'accent' };
// A record without a saved version (version 0) has nothing to decide yet.
const pitchState = (pitch: IdeaPitch) => pitch.projectId ? 'project' : pitch.outcome || (pitch.version ? 'draft' : 'unsaved');

export function IdeaPitches({ userId, onProjectCreated }: { userId: string; onProjectCreated: () => Promise<void> }) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [pitches, setPitches] = useState<IdeaPitch[] | null>(null);
  const selectionKey = checklistDraftKey(userId, 'idea:selected');
  const [selected, setSelected] = useState(() => readChecklistDraft(selectionKey, ''));
  const [displayed, setDisplayed] = useState(selected);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
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
    setPitches((await requestJson<{ pitches: IdeaPitch[] }>('/api/idea-pitches', 'Could not load idea pitches.')).pitches);
  }
  useEffect(() => {
    let active = true;
    void requestJson<{ pitches: IdeaPitch[] }>('/api/idea-pitches', 'Could not load idea pitches.')
      .then((data) => { if (active) setPitches(data.pitches); })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : 'Could not load.'); });
    return () => { active = false; };
  }, []);
  const matchingPitches = (pitches || []).filter(pitch => `${pitch.title} @${pitch.ownerUsername}`.toLowerCase().includes(search.trim().toLowerCase()) && (filter === 'all' || pitchState(pitch) === filter));
  const current = pitches?.find(pitch => pitch.id === displayed);
  return <section className="checklist-panel idea-pitches-panel">
    {error && <p role="alert" className="ops-notice error checklist-page-notice">{error} <button className="ops-secondary" type="button" onClick={() => { setError(''); void load().catch((caught) => setError(caught.message)); }}>Retry</button></p>}
    {status && <p role="status" className="form-message checklist-page-notice">{status}</p>}
    <div className="checklist-workspace">
      <aside className="checklist-list" aria-label="Pitch list">
        <button className="ops-secondary checklist-new" type="button" disabled={editorState.busy} onClick={() => openPitch('')}><Plus aria-hidden="true" />New pitch</button>
        <button type="button" className="checklist-list-toggle" aria-expanded={listOpen} aria-controls="idea-list-body" onClick={() => setListOpen(open => !open)}>
          <span>{listOpen ? 'Hide saved pitches' : `Saved pitches${pitches ? ` (${pitches.length})` : ''}`}</span>
          {!listOpen && <small>{current ? `Open: ${current.title}` : 'Open: new pitch'}</small>}
          <ChevronDown aria-hidden="true" />
        </button>
        <div id="idea-list-body" className="checklist-list-body" data-open={listOpen}>
          {(pitches?.length || 0) > 0 && <div className="checklist-list-filters">
            <label>Find a pitch<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Title or @username" /></label>
            <label>Status<select value={filter} onChange={event => setFilter(event.target.value)}><option value="all">All statuses</option><option value="unsaved">Not saved yet</option><option value="draft">Awaiting decision</option><option value="revise">Revise</option><option value="proceed">Proceed</option><option value="stop">Stop</option><option value="project">Project created</option></select></label>
          </div>}
          {pitches === null && <span className="checklist-list-note" role="status">{error ? 'Saved pitches unavailable.' : 'Loading saved pitches…'}</span>}
          {pitches && matchingPitches.length === 0 && <p className="checklist-list-note" role="status">{pitches.length ? 'No pitches match this search.' : 'No saved pitches yet.'}</p>}
          {railGroups.map(group => {
            const items = matchingPitches.filter(pitch => pitch.access === group.access);
            return items.length > 0 && <div className="checklist-list-group" key={group.access}>
              <h2 className="vs-caps">{group.label}</h2>
              <ul>{items.map(pitch => <li key={pitch.id}>
                <button type="button" data-pitch-id={pitch.id} className={`checklist-list-item${pitch.id === displayed ? ' active' : ''}`} aria-current={pitch.id === displayed ? 'true' : undefined} disabled={editorState.busy} onClick={() => { if (pitch.id !== displayed) openPitch(pitch.id); else setListOpen(false); }}>
                  <span>{pitch.title}</span>
                  <small>{group.access !== 'owner' && <>@{pitch.ownerUsername} · </>}<span className={`checklist-status is-${statusTone[pitchState(pitch)]}`}>{statusLabels[pitchState(pitch)]}</span>{pitch.version ? <> · <span className="vs-mono">v{pitch.version}</span></> : null}{pitch.updatedAt ? ` · ${formatShortDay(pitch.updatedAt)}` : ''}</small>
                </button>
              </li>)}</ul>
            </div>;
          })}
        </div>
        <p className="checklist-list-note">An empty editor does not create a pitch. A pitch is stored only when you save it.</p>
      </aside>
      <div ref={editorRef} className="checklist-record-host"><IdeaPitchEditor userId={userId} key={`${selected}-${newDraft}`} pitchId={selected} onProjectCreated={onProjectCreated} onStateChanged={setEditorState} onDeleted={async () => { discardDrafts(); writeChecklistDraft(selectionKey, ''); setPitches(current => current?.filter(pitch => pitch.id !== displayed) || []); setSelected(''); setDisplayed(''); setNewDraft(value => value + 1); setStatus('Pitch deleted.'); try { await load(); } catch { setError('Pitch deleted, but the saved list could not refresh. Retry.'); } }} onChanged={async (id) => { writeChecklistDraft(selectionKey, id); setStatus(''); setDisplayed(id); await load(); }} /></div>
    </div>
    <ConfirmDialog id="idea-switch-confirm" open={pendingSwitch !== null} tone="default" title="Discard unsaved changes?"
      message="This pitch has changes that are not saved. Switching will discard them; the last saved version is kept."
      confirmLabel="Discard and switch" cancelLabel="Keep editing" onCancel={() => setPendingSwitch(null)} onConfirm={() => switchTo(pendingSwitch ?? '')} />
  </section>;
}
