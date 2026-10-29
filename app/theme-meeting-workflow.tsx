'use client';
import { themeUpdateTypeLabels } from '../src/mastra/theme-meetings/schema';

import { MeetingProjectSummary } from './meeting-project-summary';

import { useEffect, useState } from 'react';
import { requestJson } from './client-request';
import type { AgendaConfirmation, MeetingAction } from '../src/mastra/theme-meetings/workflow';
import type { ThemeMeetingAgendaItem } from '../src/mastra/theme-meetings/schema';

type Payload = {
  manager: boolean; cancelled: boolean; duration: number; sourceVersion: string; members: string[];
  candidates: ThemeMeetingAgendaItem[]; confirmation: AgendaConfirmation | null;
  projects: Array<{ id: string; title: string }>;
  actions: Array<MeetingAction & { version: string; projectTitle: string | null }>;
};
type Selection = { username: string; minutes: number; deferred: boolean };
export function ThemeMeetingWorkflow({ themeId, meetingDate, onChanged }: {
  themeId: string; meetingDate: string; onChanged: () => Promise<void> | void;
}) {
  const [date, setDate] = useState(meetingDate);
  const [data, setData] = useState<Payload | null>(null);
  const [entries, setEntries] = useState<Selection[]>([]);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [action, setAction] = useState({ decision: '', task: '', owner: '', dueDate: '', projectId: '' });
  const [notes, setNotes] = useState<Record<string, string>>({});
  useEffect(() => { setDate(meetingDate); }, [meetingDate]);
  useEffect(() => {
    let active = true;
    setData(null); setError(''); setStatus(''); setNotes({});
    void requestJson<Payload>(`/api/theme-meetings/workflow?${new URLSearchParams({ meetingDate: date, themeId })}`, 'Could not load meeting workflow.')
      .then((payload) => {
        if (!active) return;
        setData(payload);
        const existing = payload.confirmation?.entries || [];
        const ordered = [...payload.candidates].sort((a, b) => {
          const index = (username?: string) => { const i = existing.findIndex((item) => item.member_username === username); return i < 0 ? existing.length : i; };
          return index(a.member_username) - index(b.member_username);
        });
        setEntries(ordered.map((item) => {
          const saved = existing.find((entry) => entry.member_username === item.member_username);
          return { username: item.member_username || '', minutes: item.update_type === 'short_update' ? 5 : item.update_type === 'nothing_to_report' ? 0 : saved?.update_type === item.update_type ? saved.duration_minutes : item.duration_minutes, deferred: saved?.deferred ?? false };
        }));
        setAction({ decision: '', task: '', owner: '', dueDate: '', projectId: '' });
      }).catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : 'Could not load.'); });
    return () => { active = false; };
  }, [date, themeId, revision]);
  async function save(body: Record<string, unknown>) {
    setBusy(true); setError(''); setStatus('');
    try {
      await requestJson('/api/theme-meetings/workflow', 'Could not save meeting changes.', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, themeId, meetingDate: date }),
      });
      setRevision((value) => value + 1);
      await onChanged();
      setStatus('Saved.');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not save.'); }
    finally { setBusy(false); }
  }
  const total = entries.filter((item) => !item.deferred).reduce((sum, item) => sum + item.minutes, 0);
  function move(index: number, offset: number) {
    setEntries((current) => { const next = [...current]; [next[index], next[index + offset]] = [next[index + offset], next[index]]; return next; });
  }
  const open = data?.actions.filter((item) => item.status === 'open') || [];
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return <details className="theme-workflow" id={`theme-workflow-${themeId}`}>
    <summary>Confirmed agenda and follow-up</summary>
    <div className="theme-workflow-body" aria-busy={busy}>
      <div className="theme-workflow-date">
        <label>Meeting date <input type="date" value={date} disabled={busy} onChange={(event) => { if (event.target.value) setDate(event.target.value); }} /></label>
        <p className="ops-muted-line">Choose an earlier meeting to record its decisions. Open actions remain visible at later meetings of this theme.</p>
      </div>
      {error && <p className="form-message error" role="alert">{error} <button className="ops-secondary" type="button" disabled={busy} onClick={() => setRevision((value) => value + 1)}>Reload</button></p>}
      {status && <p className="form-message" role="status">{status}</p>}
      {!data ? <p className="ops-muted-line" role="status">{error ? 'Meeting records unavailable.' : 'Loading meeting records…'}</p> : <>
        <p className={`theme-workflow-state ${data.confirmation ? 'is-confirmed' : 'is-draft'}`}>{data.confirmation ? `Confirmed v${data.confirmation.version} by @${data.confirmation.confirmedBy} on ${new Date(data.confirmation.confirmedAt).toLocaleString('en-GB', { timeZone: 'Europe/London' })} (UK time)` : 'Draft — awaiting coordinator confirmation.'}</p>
        {data.confirmation && <ol className="theme-workflow-confirmed">{data.confirmation.entries.map((entry) => <li key={entry.member_username || entry.member}>
          <strong>{entry.member}</strong> <span>{themeUpdateTypeLabels[entry.update_type]} · {entry.duration_minutes} min{entry.deferred ? ' · Deferred — not booked into a future meeting' : ''}</span>
          <MeetingProjectSummary context={entry.project_context} />
        </li>)}</ol>}
        {data.manager && !data.cancelled && <form className="theme-workflow-panel" onSubmit={(event) => { event.preventDefault(); void save({ operation: 'confirm', sourceVersion: data.sourceVersion, entries }); }}>
          <fieldset disabled={busy}><legend>{data.confirmation ? 'Review and confirm a new version' : 'Prepare the agenda'}</legend>
            <p>Latest submissions below. Confirmation saves a fixed version. Later updates will not change it.</p>
            <ol className="theme-workflow-entries">{entries.map((entry, index) => {
              const candidate = data.candidates.find((item) => item.member_username === entry.username)!;
              return <li key={entry.username} className="theme-workflow-entry">
                <strong>{candidate.member}</strong><p className="theme-workflow-progress">{candidate.progress_text}</p><MeetingProjectSummary context={candidate.project_context} />
                <label>Minutes <input type="number" min={candidate.update_type === 'nothing_to_report' ? 0 : 1} max={60} required value={entry.minutes}
                  readOnly={['short_update', 'nothing_to_report'].includes(candidate.update_type)}
                  onChange={(event) => setEntries((current) => current.map((item, i) => i === index ? { ...item, minutes: Number(event.target.value) } : item))} /></label>
                <label className="theme-workflow-checkbox"><input type="checkbox" checked={entry.deferred} onChange={(event) => setEntries((current) => current.map((item, i) => i === index ? { ...item, deferred: event.target.checked } : item))} /> Defer this item</label>
                <button className="ops-secondary" type="button" aria-label={`Move ${candidate.member} earlier`} disabled={index === 0} onClick={() => move(index, -1)}>↑ Earlier</button>
                <button className="ops-secondary" type="button" aria-label={`Move ${candidate.member} later`} disabled={index === entries.length - 1} onClick={() => move(index, 1)}>↓ Later</button>
              </li>;
            })}</ol>
            <p className={`theme-workflow-total${total > data.duration ? ' is-over' : ''}`} role="status">{total}/{data.duration} minutes{total > data.duration ? ' — shorten or defer items before confirming.' : ''}</p>
            <button className="ops-primary" type="submit" disabled={total > data.duration}>Confirm agenda{data.confirmation ? ' as new version' : ''}</button>
          </fieldset>
        </form>}
        {data.manager && data.confirmation && !data.cancelled && <form className="theme-workflow-panel" onSubmit={(event) => { event.preventDefault(); void save({ operation: 'add_action', action: { ...action, projectId: action.projectId || null } }); }}>
          <fieldset disabled={busy}><legend>Record a decision and next action</legend>
            <label>Related project (optional) <select value={action.projectId} onChange={(event) => setAction({ ...action, projectId: event.target.value })}>
              <option value="">No project — group action</option>{data.projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}
            </select></label>
            <p className="ops-muted-line">Linked decisions and actions are visible to people with access to that project. The responsible member must already have project access. This does not change the project stage.</p>
            <label>Decision <textarea required maxLength={2000} value={action.decision} onChange={(event) => setAction({ ...action, decision: event.target.value })} /></label>
            <label>Next action <textarea required maxLength={2000} value={action.task} onChange={(event) => setAction({ ...action, task: event.target.value })} /></label>
            <label>Responsible member <select required value={action.owner} onChange={(event) => setAction({ ...action, owner: event.target.value })}><option value="">Choose member</option>{data.members.map((member) => <option key={member} value={member}>@{member}</option>)}</select></label>
            <label>Due date <input required type="date" min={date} value={action.dueDate} onChange={(event) => setAction({ ...action, dueDate: event.target.value })} /></label>
            <button className="ops-primary" type="submit">Save decision and action</button>
          </fieldset>
        </form>}
        <h4 className="theme-workflow-heading">Follow-up · {open.length} open</h4>
        {!data.actions.length && <p className="ops-muted-line">No recorded actions.</p>}
        {data.actions.slice().sort((a, b) => a.status.localeCompare(b.status) * -1 || a.dueDate.localeCompare(b.dueDate)).map((item) => <form key={item.id} className="theme-workflow-action"
          onSubmit={(event) => { event.preventDefault(); void save({ operation: 'update_action', id: item.id, version: item.version, status: item.status, note: notes[item.id] || '' }); }}>
          <fieldset disabled={busy}><legend>{item.task}</legend>
            <p className="theme-workflow-meta">Meeting {item.meetingDate} · @{item.owner} · Due {item.dueDate} · <span className={`theme-workflow-status is-${item.status}${item.status === 'open' && item.dueDate < today ? ' is-overdue' : ''}`}>{item.status}{item.status === 'open' && item.dueDate < today ? ' · Overdue' : ''}</span></p>
            <p className="theme-workflow-meta">Project: {item.projectTitle || 'No project — group action'}</p>
            <p>Decision: {item.decision}</p>
            <details><summary>History</summary><ul>{item.history.map((change, index) => <li key={index}>@{change.by} · {change.at} · {change.status}: {change.note}</li>)}</ul></details>
            <label>Progress / completion evidence <textarea required maxLength={2000} value={notes[item.id] || ''} onChange={(event) => setNotes({ ...notes, [item.id]: event.target.value })} /></label>
            <button className="ops-secondary" type="submit">Save progress</button>
            <button className="ops-secondary" type="button" disabled={!notes[item.id]?.trim()} onClick={() => void save({ operation: 'update_action', id: item.id, version: item.version, status: item.status === 'done' ? 'open' : 'done', note: notes[item.id] })}>{item.status === 'done' ? 'Reopen' : 'Mark done'}</button>
            {!notes[item.id]?.trim() && <p className="ops-muted-line">Add a note before changing completion status.</p>}
          </fieldset>
        </form>)}
      </>}
    </div>
  </details>;
}
