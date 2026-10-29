'use client';
import { themeUpdateTypeLabels } from '../src/mastra/theme-meetings/schema';

import { MeetingProjectSummary } from './meeting-project-summary';

import { useEffect, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Check, ListOrdered, Mail } from 'lucide-react';
import { requestJson } from './client-request';
import type { AgendaConfirmation, MeetingAction } from '../src/mastra/theme-meetings/workflow';
import type { ThemeMeetingAgendaItem } from '../src/mastra/theme-meetings/schema';

type Payload = {
  manager: boolean; cancelled: boolean; duration: number; sourceVersion: string; members: string[];
  candidates: ThemeMeetingAgendaItem[]; confirmation: AgendaConfirmation | null; emailedAt?: string | null;
  projects: Array<{ id: string; title: string }>;
  actions: Array<MeetingAction & { version: string; projectTitle: string | null }>;
};
type Selection = { username: string; minutes: number; deferred: boolean };
type Row = { item: ThemeMeetingAgendaItem; minutes: number; skipped: boolean };

const ukTime = (value: string) => new Date(value).toLocaleString('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

function useWorkflow(themeId: string, date: string, revision: number, enabled = true) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    setError('');
    void requestJson<Payload>(`/api/theme-meetings/workflow?${new URLSearchParams({ meetingDate: date, themeId })}`, 'Could not load meeting workflow.')
      .then((payload) => { if (active) setData(payload); })
      .catch((caught) => { if (active) { setData(null); setError(caught instanceof Error ? caught.message : 'Could not load.'); } });
    return () => { active = false; };
  }, [date, themeId, revision, enabled]);
  return { data, error };
}

// Planned start times are derived from the meeting start and the minutes of each scheduled item.
function startTimes(meetingTime: string, minutes: number[]) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(meetingTime);
  let clock = match ? Number(match[1]) * 60 + Number(match[2]) : null;
  return minutes.map((value) => {
    if (clock === null) return '';
    const start = `${String(Math.floor(clock / 60) % 24).padStart(2, '0')}:${String(clock % 60).padStart(2, '0')}`;
    clock += value;
    return start;
  });
}

function initialSelections(payload: Payload): Selection[] {
  const existing = payload.confirmation?.entries || [];
  const index = (username?: string) => { const i = existing.findIndex((item) => item.member_username === username); return i < 0 ? existing.length : i; };
  return [...payload.candidates].sort((a, b) => index(a.member_username) - index(b.member_username)).map((item) => {
    const saved = existing.find((entry) => entry.member_username === item.member_username);
    return { username: item.member_username || '', deferred: saved?.deferred ?? false,
      minutes: item.update_type === 'short_update' ? 5 : item.update_type === 'nothing_to_report' ? 0 : saved?.update_type === item.update_type ? saved.duration_minutes : item.duration_minutes };
  });
}

function ItemSummary({ item }: { item: ThemeMeetingAgendaItem }) {
  return <span className="mt-item-main">
    <strong>{item.project_context?.title || item.member}</strong>
    <span>{item.project_context ? `${item.member} · Project stage ${item.project_context.stage ?? 'not recorded'}` : 'No linked project'}</span>
    {item.project_context && <details className="mt-snapshot"><summary>Project snapshot</summary><MeetingProjectSummary context={item.project_context} /></details>}
  </span>;
}

function AgendaBoard({ themeId, meetingDate, meetingTime, cancelled, canAccess, fallbackItems, revision, onSaved, onChanged }: {
  themeId: string; meetingDate: string; meetingTime: string; cancelled: boolean; canAccess: boolean;
  fallbackItems: ThemeMeetingAgendaItem[]; revision: number; onSaved: () => void; onChanged: () => Promise<void> | void;
}) {
  const { data, error } = useWorkflow(themeId, meetingDate, revision, canAccess);
  const [arranging, setArranging] = useState(false);
  const [entries, setEntries] = useState<Selection[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const [confirmEmail, setConfirmEmail] = useState(false);
  useEffect(() => { setArranging(false); setConfirmEmail(false); setMessage(null); }, [themeId, meetingDate, cancelled]);
  if (cancelled) return null;

  const manager = Boolean(data?.manager);
  const confirmation = data?.confirmation || null;
  const candidate = (username: string) => data!.candidates.find((item) => item.member_username === username)!;
  const rows: Row[] = arranging && data
    ? entries.map((entry) => ({ item: candidate(entry.username), minutes: entry.minutes, skipped: entry.deferred }))
    : confirmation
      ? confirmation.entries.map((entry) => ({ item: entry, minutes: entry.duration_minutes, skipped: entry.deferred }))
      : (data?.candidates || fallbackItems).map((item) => ({ item, minutes: item.duration_minutes, skipped: false }));
  const scheduled = rows.filter((row) => !row.skipped);
  const skipped = rows.filter((row) => row.skipped);
  const starts = startTimes(meetingTime, scheduled.map((row) => row.minutes));
  const duration = data?.duration || 60;
  const total = scheduled.reduce((sum, row) => sum + row.minutes, 0);
  const over = total > duration;
  const changedSinceConfirmation = Boolean(manager && confirmation && (confirmation.entries.length !== data!.candidates.length ||
    data!.candidates.some((item) => !confirmation.entries.some((entry) => entry.member_username === item.member_username && entry.submitted_at === item.submitted_at))));

  function move(username: string, direction: -1 | 1) {
    setEntries((current) => {
      const from = current.findIndex((entry) => entry.username === username);
      let to = from + direction;
      while (to >= 0 && to < current.length && current[to].deferred) to += direction;
      if (to < 0 || to >= current.length) return current;
      const next = [...current];
      [next[from], next[to]] = [next[to], next[from]];
      return next;
    });
    // Reordering moves the row in the DOM; keep keyboard focus on the control that was used.
    requestAnimationFrame(() => {
      const own = document.querySelector<HTMLButtonElement>(`[data-agenda-move="${CSS.escape(`${username}:${direction}`)}"]`);
      (own && !own.disabled ? own : document.querySelector<HTMLButtonElement>(`[data-agenda-move="${CSS.escape(`${username}:${-direction}`)}"]`))?.focus();
    });
  }
  const update = (username: string, patch: Partial<Selection>) => setEntries((current) => current.map((entry) => entry.username === username ? { ...entry, ...patch } : entry));

  async function post(body: Record<string, unknown>, fallback: string) {
    return requestJson<{ version?: number; emails?: { sent: number; skipped: number; failed: number } }>('/api/theme-meetings/workflow', fallback, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, themeId, meetingDate }),
    });
  }
  async function confirm() {
    if (!data) return;
    setBusy(true); setMessage(null);
    try {
      await post({ operation: 'confirm', sourceVersion: data.sourceVersion, entries }, 'Could not confirm the agenda.');
      setArranging(false);
      setMessage({ error: false, text: `Version ${(confirmation?.version || 0) + 1} confirmed. Email the final agenda when you are ready.` });
      onSaved();
      await onChanged();
    } catch (caught) { setMessage({ error: true, text: caught instanceof Error ? caught.message : 'Could not confirm the agenda.' }); }
    finally { setBusy(false); }
  }
  async function sendEmail() {
    if (!confirmation) return;
    setBusy(true); setMessage(null);
    try {
      const result = await post({ operation: 'email_confirmed', version: confirmation.version }, 'Could not email the agenda.');
      const emails = result.emails || { sent: 0, skipped: 0, failed: 0 };
      setMessage({ error: emails.failed > 0, text: `Version ${confirmation.version} emailed: ${emails.sent} sent, ${emails.skipped} skipped, ${emails.failed} failed.${emails.skipped ? ' Skipped recipients already received this version, have agenda emails switched off or have no email address.' : ''}` });
      setConfirmEmail(false);
      onSaved();
    } catch (caught) { setMessage({ error: true, text: caught instanceof Error ? caught.message : 'Could not email the agenda.' }); }
    finally { setBusy(false); }
  }

  function row({ item, minutes, skipped: isSkipped }: Row, start: string) {
    const username = item.member_username || item.member;
    const fixed = item.update_type !== 'deep_dive';
    const position = scheduled.findIndex((entry) => entry.item === item);
    return <li key={username} className={isSkipped ? 'is-skipped' : undefined}>
      <time className="vs-mono" aria-label={start ? `Planned start ${start}` : undefined}>{isSkipped ? '—' : start}</time>
      <ItemSummary item={item} />
      {arranging ? <span className="mt-arrange-controls">
        <span className={`mt-slot mt-slot-${item.update_type}`}>{themeUpdateTypeLabels[item.update_type]}</span>
        <label className="mt-minutes">
          <input type="number" inputMode="numeric" min={item.update_type === 'nothing_to_report' ? 0 : 1} max={60} required value={minutes} readOnly={fixed}
            disabled={isSkipped} aria-label={`Minutes for ${item.member}`} aria-describedby="mt-arrange-hint"
            onChange={(event) => update(username, { minutes: Number(event.target.value) })} />
          <span aria-hidden="true">min</span></label>
        {!isSkipped && <>
          <button className="mt-icon-btn" type="button" data-agenda-move={`${username}:-1`} aria-label={`Move ${item.member} earlier`} disabled={busy || position <= 0} onClick={() => move(username, -1)}><ArrowUp aria-hidden="true" /></button>
          <button className="mt-icon-btn" type="button" data-agenda-move={`${username}:1`} aria-label={`Move ${item.member} later`} disabled={busy || position === scheduled.length - 1} onClick={() => move(username, 1)}><ArrowDown aria-hidden="true" /></button>
        </>}
        <label className="mt-skip-toggle"><input type="checkbox" checked={isSkipped} disabled={busy} aria-label={`Skip ${item.member} at this meeting`}
          onChange={(event) => update(username, { deferred: event.target.checked })} /><span aria-hidden="true">Skip</span></label>
      </span> : <span className={`mt-slot mt-slot-${item.update_type}`}>{themeUpdateTypeLabels[item.update_type]}{isSkipped ? '' : ` · ${minutes} min`}</span>}
    </li>;
  }

  return <div className={`mt-board${arranging ? ' is-arranging' : ''}`} aria-busy={busy}>
    <div className="mt-board-bar">
      <p className={`mt-board-state ${arranging ? 'is-arranging' : confirmation ? 'is-confirmed' : 'is-draft'}`}>
        {arranging ? <><strong>Arranging</strong> · Changes are saved only when you confirm.</>
          : confirmation ? <><strong>Confirmed</strong> · Version {confirmation.version} by @{confirmation.confirmedBy}, {ukTime(confirmation.confirmedAt)} (UK time){data?.emailedAt ? ` · Emailed ${ukTime(data.emailedAt)}` : ''}</>
            : <><strong>Draft</strong> · From submitted updates; not yet confirmed by the coordinator.</>}
      </p>
      {manager && !arranging && <div className="mt-board-actions">
        {data!.candidates.length > 0 && <button className="ops-secondary" type="button" disabled={busy} onClick={() => { setEntries(initialSelections(data!)); setArranging(true); setConfirmEmail(false); setMessage(null); }}>
          <ListOrdered aria-hidden="true" />Arrange agenda</button>}
        {confirmation && <button className="ops-primary" type="button" disabled={busy} aria-expanded={confirmEmail} onClick={() => setConfirmEmail(true)}>
          <Mail aria-hidden="true" />Email final agenda</button>}
      </div>}
    </div>
    {error && <p className="form-message error" role="alert">{error}</p>}
    {changedSinceConfirmation && !arranging && <p className="mt-board-note" role="note">Submissions changed after version {confirmation!.version} was confirmed. Arrange the agenda to confirm a new version that includes them.</p>}
    {confirmEmail && confirmation && <div className="mt-inline-confirm" role="group" aria-labelledby="mt-email-confirm-text">
      <p id="mt-email-confirm-text">Email version {confirmation.version} of the agenda to theme members, PIs and the administrator, and agenda subscribers?{data?.emailedAt ? ' This version was already emailed; people who received it will not get a duplicate.' : ''}</p>
      <div><button className="ops-secondary" type="button" disabled={busy} onClick={() => setConfirmEmail(false)}>Cancel</button>
        <button className="ops-primary" type="button" disabled={busy} onClick={() => void sendEmail()}>{busy ? 'Sending' : 'Send email'}</button></div>
    </div>}
    {message && <p className={`form-message${message.error ? ' error' : ''}`} role={message.error ? 'alert' : 'status'}>{message.text}</p>}
    {arranging && <p id="mt-arrange-hint" className="mt-board-hint">Use the arrows to reorder. Updates are 5 minutes and Nothing to Report is 0 minutes; Deep Dive minutes can be edited. Skipped items are left out of this meeting.</p>}
    {scheduled.length ? <ol className="mt-agenda-list" aria-label={arranging ? 'Agenda order' : 'Agenda'}>{scheduled.map((item, index) => row(item, starts[index]))}</ol>
      : <p className="mt-agenda-empty">{rows.length ? 'Every item is skipped.' : 'No planned updates yet'}</p>}
    {skipped.length > 0 && <section className="mt-skipped" aria-label="Skipped items">
      <h3>Skipped · not scheduled at this meeting</h3>
      <ul className="mt-agenda-list">{skipped.map((item) => row(item, ''))}</ul>
    </section>}
    {arranging && <div className="mt-arrange-footer">
      <div className={`mt-arrange-total${over ? ' is-over' : ''}`} role="status">
        <span className={`mt-meter${over ? ' is-over' : ''}`} aria-hidden="true"><span style={{ width: `${Math.min(100, Math.round((total / duration) * 100))}%` }} /></span>
        <span className="mt-num">{total} of {duration} min{over ? ` · ${total - duration} min over. Shorten or skip items before confirming.` : ` · ${duration - total} min free`}</span>
      </div>
      <div className="mt-arrange-buttons">
        <button className="ops-secondary" type="button" disabled={busy} onClick={() => setArranging(false)}>Cancel</button>
        <button className="ops-primary" type="button" disabled={busy || over} onClick={() => void confirm()}><Check aria-hidden="true" />{busy ? 'Confirming' : 'Confirm final agenda'}</button>
      </div>
    </div>}
  </div>;
}

function FollowUp({ themeId, meetingDate, revision, onChanged }: {
  themeId: string; meetingDate: string; revision: number; onChanged: () => Promise<void> | void;
}) {
  const [date, setDate] = useState(meetingDate);
  const [local, setLocal] = useState(0);
  const { data, error } = useWorkflow(themeId, date, revision + local);
  const [status, setStatus] = useState('');
  const [failure, setFailure] = useState('');
  const [busy, setBusy] = useState(false);
  const [action, setAction] = useState({ decision: '', task: '', owner: '', dueDate: '', projectId: '' });
  const [notes, setNotes] = useState<Record<string, string>>({});
  useEffect(() => { setDate(meetingDate); }, [meetingDate]);
  useEffect(() => { setStatus(''); setFailure(''); setNotes({}); setAction({ decision: '', task: '', owner: '', dueDate: '', projectId: '' }); }, [date, themeId]);
  async function save(body: Record<string, unknown>) {
    setBusy(true); setFailure(''); setStatus('');
    try {
      await requestJson('/api/theme-meetings/workflow', 'Could not save meeting changes.', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, themeId, meetingDate: date }),
      });
      setLocal((value) => value + 1);
      if (body.operation === 'add_action') setAction({ decision: '', task: '', owner: '', dueDate: '', projectId: '' });
      await onChanged();
      setStatus('Saved.');
    } catch (caught) { setFailure(caught instanceof Error ? caught.message : 'Could not save.'); }
    finally { setBusy(false); }
  }
  const open = data?.actions.filter((item) => item.status === 'open') || [];
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return <details className="theme-workflow" id={`theme-workflow-${themeId}`}>
    <summary>Decisions and follow-up{data ? ` · ${open.length} open` : ''}</summary>
    <div className="theme-workflow-body" aria-busy={busy}>
      <div className="theme-workflow-date">
        <label>Meeting date <input type="date" value={date} disabled={busy} onChange={(event) => { if (event.target.value) setDate(event.target.value); }} /></label>
        <p className="ops-muted-line">Choose an earlier meeting to see its confirmed agenda and record its decisions. Open actions remain visible at later meetings of this theme.</p>
      </div>
      {(error || failure) && <p className="form-message error" role="alert">{failure || error} <button className="ops-secondary" type="button" disabled={busy} onClick={() => setLocal((value) => value + 1)}>Reload</button></p>}
      {status && <p className="form-message" role="status">{status}</p>}
      {!data ? <p className="ops-muted-line" role="status">{error ? 'Meeting records unavailable.' : 'Loading meeting records…'}</p> : <>
        {date !== meetingDate && <>
          <p className={`theme-workflow-state ${data.confirmation ? 'is-confirmed' : 'is-draft'}`}>{data.confirmation ? `Confirmed v${data.confirmation.version} by @${data.confirmation.confirmedBy} on ${ukTime(data.confirmation.confirmedAt)} (UK time)` : 'No confirmed agenda for this date.'}</p>
          {data.confirmation && <ol className="theme-workflow-confirmed">{data.confirmation.entries.map((entry) => <li key={entry.member_username || entry.member}>
            <strong>{entry.member}</strong> <span>{themeUpdateTypeLabels[entry.update_type]} · {entry.duration_minutes} min{entry.deferred ? ' · Skipped at this meeting' : ''}</span>
            <MeetingProjectSummary context={entry.project_context} />
          </li>)}</ol>}
        </>}
        {data.manager && !data.confirmation && !data.cancelled && <p className="ops-muted-line">Confirm the final agenda before recording decisions and actions.</p>}
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

/** The current agenda (view, arrange, confirm, email) followed by decisions and follow-up for the theme. */
export function ThemeMeetingWorkflow({ themeId, meetingDate, meetingTime, cancelled, canAccess, fallbackItems, onChanged, children }: {
  themeId: string; meetingDate: string; meetingTime: string; cancelled: boolean; canAccess: boolean;
  fallbackItems: ThemeMeetingAgendaItem[]; onChanged: () => Promise<void> | void; children?: ReactNode;
}) {
  const [revision, setRevision] = useState(0);
  return <>
    <AgendaBoard themeId={themeId} meetingDate={meetingDate} meetingTime={meetingTime} cancelled={cancelled} canAccess={canAccess}
      fallbackItems={fallbackItems} revision={revision} onSaved={() => setRevision((value) => value + 1)} onChanged={onChanged} />
    {children}
    {canAccess && <FollowUp themeId={themeId} meetingDate={meetingDate} revision={revision} onChanged={onChanged} />}
  </>;
}
