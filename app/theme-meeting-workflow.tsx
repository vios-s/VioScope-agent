'use client';
import { themeUpdateTypeLabels } from '../src/mastra/theme-meetings/schema';

import { MeetingProjectSummary } from './meeting-project-summary';
import { ConfirmDialog } from './confirm-dialog';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Check, GripVertical, Mail, RotateCcw } from 'lucide-react';
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
type Drag = { username: string; from: number; to: number; dy: number; height: number };

const ukTime = (value: string) => new Date(value).toLocaleString('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
const sameSelections = (a: Selection[], b: Selection[]) => a.length === b.length &&
  a.every((entry, index) => entry.username === b[index].username && entry.minutes === b[index].minutes && entry.deferred === b[index].deferred);

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

function scrollParent(element: HTMLElement): HTMLElement {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) return node;
  }
  return document.scrollingElement as HTMLElement;
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
  // Local order and minutes; null means "same as the server baseline". Nothing is saved until Confirm.
  const [edited, setEdited] = useState<Selection[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const [dialog, setDialog] = useState<'confirm' | 'email' | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [drag, setDrag] = useState<Drag | null>(null);
  const listRef = useRef<HTMLOListElement | null>(null);
  const dragRef = useRef<{ drag: Drag; mids: number[]; startY: number; clientY: number; scroller: HTMLElement; frame: number } | null>(null);
  const baseline = useMemo(() => data ? initialSelections(data) : [], [data]);
  useEffect(() => { setEdited(null); }, [baseline]);
  useEffect(() => { setDialog(null); setMessage(null); setEdited(null); }, [themeId, meetingDate, cancelled]);
  useEffect(() => () => { if (dragRef.current) cancelAnimationFrame(dragRef.current.frame); }, []);
  if (cancelled) return null;

  const manager = Boolean(data?.manager);
  const editable = Boolean(manager && data && data.candidates.length);
  const entries = edited ?? baseline;
  const dirty = Boolean(edited && !sameSelections(edited, baseline));
  const confirmation = data?.confirmation || null;
  const candidate = (username: string) => data!.candidates.find((item) => item.member_username === username)!;
  const rows: Row[] = editable
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
  const confirmedSelections = (confirmation?.entries || []).map((entry) => ({ username: entry.member_username || '', minutes: entry.duration_minutes, deferred: entry.deferred }));
  const upToDate = Boolean(confirmation && !changedSinceConfirmation && sameSelections(entries, confirmedSelections));
  const nextVersion = (confirmation?.version || 0) + 1;
  const scheduledNames = scheduled.map((row) => row.item.member_username || row.item.member);

  const update = (username: string, patch: Partial<Selection>) => setEdited(entries.map((entry) => entry.username === username ? { ...entry, ...patch } : entry));
  function reorder(from: number, to: number) {
    if (from === to || to < 0 || to >= scheduledNames.length) return;
    const order = [...scheduledNames];
    const [moved] = order.splice(from, 1);
    order.splice(to, 0, moved);
    const byName = new Map(entries.map((entry) => [entry.username, entry]));
    setEdited([...order.map((name) => byName.get(name)!), ...entries.filter((entry) => entry.deferred)]);
    const row = scheduled[from];
    setAnnouncement(`${row.item.member} moved to position ${to + 1} of ${order.length}.`);
  }
  function onHandleKey(event: KeyboardEvent<HTMLButtonElement>, username: string) {
    const direction = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
    if (!direction) return;
    event.preventDefault();
    const from = scheduledNames.indexOf(username);
    reorder(from, from + direction);
    // Reordering moves the row in the DOM; keep keyboard focus on its handle.
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-agenda-handle="${CSS.escape(username)}"]`)?.focus());
  }

  // Pointer Events cover mouse, pen and touch; the handle has touch-action: none so the page does not scroll instead.
  function trackDrag() {
    const state = dragRef.current;
    if (!state) return;
    const scrollTop = state.scroller.scrollTop;
    const dy = state.clientY + scrollTop - state.startY;
    const centre = state.mids[state.drag.from] + dy;
    const to = state.mids.filter((mid, index) => index !== state.drag.from && mid < centre).length;
    state.drag = { ...state.drag, dy, to };
    setDrag(state.drag);
  }
  function autoScroll() {
    const state = dragRef.current;
    if (!state) return;
    const isPage = state.scroller === document.scrollingElement;
    const top = isPage ? 0 : state.scroller.getBoundingClientRect().top;
    const bottom = isPage ? window.innerHeight : state.scroller.getBoundingClientRect().bottom;
    const edge = 64;
    const speed = state.clientY < top + edge ? -Math.ceil((top + edge - state.clientY) / 4) : state.clientY > bottom - edge ? Math.ceil((state.clientY - bottom + edge) / 4) : 0;
    if (speed) { state.scroller.scrollTop += speed; trackDrag(); }
    state.frame = requestAnimationFrame(autoScroll);
  }
  function startDrag(event: ReactPointerEvent<HTMLButtonElement>, username: string) {
    if (busy || (event.pointerType === 'mouse' && event.button !== 0) || !listRef.current) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const scroller = scrollParent(listRef.current);
    const rects = Array.from(listRef.current.children).map((element) => element.getBoundingClientRect());
    const from = scheduledNames.indexOf(username);
    const mids = rects.map((rect) => rect.top + scroller.scrollTop + rect.height / 2);
    const drag = { username, from, to: from, dy: 0, height: rects[from].height };
    dragRef.current = { drag, mids, startY: event.clientY + scroller.scrollTop, clientY: event.clientY, scroller, frame: requestAnimationFrame(autoScroll) };
    setDrag(drag);
  }
  function moveDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!dragRef.current) return;
    dragRef.current.clientY = event.clientY;
    trackDrag();
  }
  function endDrag(commit: boolean) {
    const state = dragRef.current;
    if (!state) return;
    cancelAnimationFrame(state.frame);
    dragRef.current = null;
    setDrag(null);
    if (commit) reorder(state.drag.from, state.drag.to);
  }
  function shift(index: number) {
    if (!drag) return undefined;
    if (index === drag.from) return { transform: `translateY(${drag.dy}px)` };
    if (drag.from < drag.to && index > drag.from && index <= drag.to) return { transform: `translateY(${-drag.height}px)` };
    if (drag.from > drag.to && index >= drag.to && index < drag.from) return { transform: `translateY(${drag.height}px)` };
    return undefined;
  }

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
      setMessage({ error: false, text: `Version ${nextVersion} confirmed. Email it when you are ready.` });
      onSaved();
      await onChanged();
    } catch (caught) { setMessage({ error: true, text: caught instanceof Error ? caught.message : 'Could not confirm the agenda.' }); }
    finally { setBusy(false); setDialog(null); }
  }
  async function sendEmail() {
    if (!confirmation) return;
    setBusy(true); setMessage(null);
    try {
      const result = await post({ operation: 'email_confirmed', version: confirmation.version }, 'Could not email the agenda.');
      const emails = result.emails || { sent: 0, skipped: 0, failed: 0 };
      setMessage({ error: emails.failed > 0, text: `Version ${confirmation.version} emailed: ${emails.sent} sent, ${emails.skipped} skipped, ${emails.failed} failed.${emails.skipped ? ' Skipped recipients already received this version, have agenda emails switched off or have no email address.' : ''}` });
      onSaved();
    } catch (caught) { setMessage({ error: true, text: caught instanceof Error ? caught.message : 'Could not email the agenda.' }); }
    finally { setBusy(false); setDialog(null); }
  }

  function row({ item, minutes, skipped: isSkipped }: Row, start: string, index: number) {
    const username = item.member_username || item.member;
    const fixed = item.update_type !== 'deep_dive';
    const dragging = drag?.username === username;
    return <li key={username} className={`${isSkipped ? 'is-skipped' : ''}${dragging ? ' is-dragging' : ''}`} style={isSkipped ? undefined : shift(index)}>
      {editable && (isSkipped ? <span aria-hidden="true" /> : <button className="mt-drag-handle" type="button" data-agenda-handle={username}
        aria-label={`Reorder ${item.member}, position ${index + 1} of ${scheduled.length}`} aria-describedby={`mt-drag-hint-${themeId}`} disabled={busy}
        onPointerDown={(event) => startDrag(event, username)} onPointerMove={moveDrag} onPointerUp={() => endDrag(true)} onPointerCancel={() => endDrag(false)}
        onLostPointerCapture={() => endDrag(true)} onKeyDown={(event) => onHandleKey(event, username)}>
        <GripVertical aria-hidden="true" /></button>)}
      <time className="vs-mono" aria-label={start ? `Planned start ${start}` : undefined}>{isSkipped ? '—' : start}</time>
      <ItemSummary item={item} />
      {editable ? <span className="mt-arrange-controls">
        <span className={`mt-slot mt-slot-${item.update_type}`}>{themeUpdateTypeLabels[item.update_type]}</span>
        <label className="mt-minutes">
          <input type="number" inputMode="numeric" min={item.update_type === 'nothing_to_report' ? 0 : 1} max={60} required value={minutes} readOnly={fixed}
            disabled={isSkipped || busy} aria-label={`Minutes for ${item.member}`} aria-describedby={`mt-drag-hint-${themeId}`}
            onChange={(event) => update(username, { minutes: Number(event.target.value) })} />
          <span aria-hidden="true">min</span></label>
        <label className="mt-skip-toggle"><input type="checkbox" checked={isSkipped} disabled={busy} aria-label={`Skip ${item.member} at this meeting`}
          onChange={(event) => update(username, { deferred: event.target.checked })} /><span aria-hidden="true">Skip</span></label>
      </span> : <span className={`mt-slot mt-slot-${item.update_type}`}>{themeUpdateTypeLabels[item.update_type]}{isSkipped ? '' : ` · ${minutes} min`}</span>}
    </li>;
  }

  const emailHintId = `mt-email-hint-${themeId}`;
  return <div className={`mt-board${editable ? ' is-editable' : ''}`} aria-busy={busy}>
    <div className="mt-board-bar">
      <p className={`mt-board-state ${confirmation ? 'is-confirmed' : 'is-draft'}`}>
        {confirmation ? <><strong>Confirmed</strong> · Version {confirmation.version} by @{confirmation.confirmedBy}, {ukTime(confirmation.confirmedAt)} (UK time){manager ? (data?.emailedAt ? ` · Emailed ${ukTime(data.emailedAt)}` : ' · Not emailed yet') : ''}</>
          : <><strong>Draft</strong> · From submitted updates; not yet confirmed by the coordinator.</>}
      </p>
      {dirty && <p className="mt-unsaved" role="status"><strong>Unsaved order</strong>
        <button className="mt-link-btn" type="button" disabled={busy} onClick={() => { setEdited(null); setAnnouncement('Order reset.'); }} aria-label="Reset agenda to the saved order">
          <RotateCcw aria-hidden="true" />Reset</button></p>}
    </div>
    {error && <p className="form-message error" role="alert">{error}</p>}
    {changedSinceConfirmation && <p className="mt-board-note" role="note">Submissions changed after version {confirmation!.version} was confirmed. This draft includes them; confirm again to save version {nextVersion}.</p>}
    {!changedSinceConfirmation && confirmation && editable && !upToDate && <p className="mt-board-note is-subtle" role="note">This draft differs from confirmed version {confirmation.version}. Email still sends version {confirmation.version} until you confirm again.</p>}
    {message && <p className={`form-message${message.error ? ' error' : ''}`} role={message.error ? 'alert' : 'status'}>{message.text}</p>}
    {editable && <p id={`mt-drag-hint-${themeId}`} className="mt-board-hint">Drag the handle, or focus it and press the arrow keys, to reorder. Updates are 5 minutes and Nothing to Report is 0 minutes; Deep Dive minutes can be edited.</p>}
    <p className="vs-sr-only" aria-live="polite">{announcement}</p>
    {scheduled.length ? <ol ref={listRef} className={`mt-agenda-list${drag ? ' is-sorting' : ''}`} aria-label="Agenda">{scheduled.map((item, index) => row(item, starts[index], index))}</ol>
      : <p className="mt-agenda-empty">{rows.length ? 'Every item is skipped.' : 'No planned updates yet'}</p>}
    {skipped.length > 0 && <section className="mt-skipped" aria-label="Skipped items">
      <h3>Skipped · not scheduled at this meeting</h3>
      <ul className="mt-agenda-list">{skipped.map((item, index) => row(item, '', index))}</ul>
    </section>}
    {manager && <div className="mt-arrange-footer">
      <div className={`mt-arrange-total${over ? ' is-over' : ''}`} role="status">
        <span className={`mt-meter${over ? ' is-over' : ''}`} aria-hidden="true"><span style={{ width: `${Math.min(100, Math.round((total / duration) * 100))}%` }} /></span>
        <span className="mt-num">{total} of {duration} min{over ? ` · ${total - duration} min over. Shorten or skip items.` : ` · ${duration - total} min free`}</span>
      </div>
      <div className="mt-arrange-buttons">
        <button className="ops-primary" type="button" disabled={busy || over || !editable || upToDate} onClick={() => setDialog('confirm')}
          aria-label={`Confirm the agenda as version ${nextVersion}`} title={upToDate ? `Version ${confirmation!.version} is already confirmed` : undefined}>
          <Check aria-hidden="true" />Confirm</button>
        <button className="ops-secondary" type="button" disabled={busy || !confirmation} onClick={() => setDialog('email')}
          aria-label={confirmation ? `Email confirmed agenda version ${confirmation.version}` : 'Email the agenda'} aria-describedby={confirmation ? undefined : emailHintId}>
          <Mail aria-hidden="true" />Email</button>
      </div>
      {!confirmation && <p id={emailHintId} className="mt-email-hint">Confirm the agenda first.</p>}
    </div>}
    <ConfirmDialog id={`mt-confirm-agenda-${themeId}`} open={dialog === 'confirm'} tone="default" title="Confirm this agenda?"
      message={`This saves version ${nextVersion} with ${plural(scheduled.length, 'item')} (${total} of ${duration} minutes)${skipped.length ? ` and ${skipped.length} skipped` : ''}. Emailing the agenda is a separate step.`}
      confirmLabel="Confirm" cancelLabel="Cancel" busy={busy} onCancel={() => setDialog(null)} onConfirm={() => void confirm()} />
    <ConfirmDialog id={`mt-email-agenda-${themeId}`} open={dialog === 'email'} tone="default" title="Email this agenda?"
      message={confirmation ? `Send confirmed version ${confirmation.version} to theme members, PIs and the administrator, and agenda subscribers.${data?.emailedAt ? ' This version was already emailed; people who received it will not get a duplicate.' : ''}` : ''}
      confirmLabel="Email" cancelLabel="Cancel" busy={busy} onCancel={() => setDialog(null)} onConfirm={() => void sendEmail()} />
  </div>;
}

function FollowUp({ themeId, meetingDate, revision, memberNames, onChanged }: {
  themeId: string; meetingDate: string; revision: number; memberNames: Record<string, string>; onChanged: () => Promise<void> | void;
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
  const person = (username: string) => memberNames[username] ? `${memberNames[username]} (@${username})` : `@${username}`;
  const open = data?.actions.filter((item) => item.status === 'open') || [];
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return <details className="theme-workflow" id={`theme-workflow-${themeId}`}>
    <summary>Decisions &amp; actions{data ? ` · ${open.length} open` : ''}</summary>
    <div className="theme-workflow-body" aria-busy={busy}>
      <p className="ops-muted-line">Each action has one responsible theme member and may link to one project. Linked actions also appear in that project’s Research workflow under Project tasks, where its members can follow progress.</p>
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
        {data.manager && !data.confirmation && !data.cancelled && <p className="ops-muted-line">Confirm the agenda before recording decisions and actions.</p>}
        {data.manager && data.confirmation && !data.cancelled && <form className="theme-workflow-panel" onSubmit={(event) => { event.preventDefault(); void save({ operation: 'add_action', action: { ...action, projectId: action.projectId || null } }); }}>
          <fieldset disabled={busy}><legend>Record a decision and action</legend>
            <label>Decision <textarea required maxLength={2000} value={action.decision} onChange={(event) => setAction({ ...action, decision: event.target.value })} /></label>
            <label>Next action <textarea required maxLength={2000} value={action.task} onChange={(event) => setAction({ ...action, task: event.target.value })} /></label>
            <div className="theme-workflow-fields">
              <label>Responsible member <select required value={action.owner} onChange={(event) => setAction({ ...action, owner: event.target.value })}><option value="">Choose member</option>{data.members.map((member) => <option key={member} value={member}>{person(member)}</option>)}</select></label>
              <label>Linked project (optional) <select value={action.projectId} onChange={(event) => setAction({ ...action, projectId: event.target.value })}>
                <option value="">No project — group action</option>{data.projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}
              </select></label>
              <label>Due date <input required type="date" min={date} value={action.dueDate} onChange={(event) => setAction({ ...action, dueDate: event.target.value })} /></label>
            </div>
            <p>The responsible member must already have access to the linked project. Linked actions appear in that project’s Research workflow → Project tasks. Linking grants no access and never changes the project stage.</p>
            <button className="ops-primary" type="submit" aria-label="Save decision and action">Save</button>
          </fieldset>
        </form>}
        <h4 className="theme-workflow-heading">Actions · {open.length} open</h4>
        {!data.actions.length && <p className="ops-muted-line">No recorded actions.</p>}
        {data.actions.slice().sort((a, b) => a.status.localeCompare(b.status) * -1 || a.dueDate.localeCompare(b.dueDate)).map((item) => {
          const overdue = item.status === 'open' && item.dueDate < today;
          return <form key={item.id} className="theme-workflow-action"
            onSubmit={(event) => { event.preventDefault(); void save({ operation: 'update_action', id: item.id, version: item.version, status: item.status, note: notes[item.id] || '' }); }}>
            <fieldset disabled={busy}><legend>{item.task}</legend>
              <dl className="theme-workflow-facts">
                <div><dt>Responsible</dt><dd>{person(item.owner)}</dd></div>
                <div><dt>Project</dt><dd>{item.projectTitle ? <>{item.projectTitle} <span className="theme-workflow-where">· in Research workflow → Project tasks</span></> : 'No project — group action'}</dd></div>
                <div><dt>Due</dt><dd className="vs-mono">{item.dueDate}</dd></div>
                <div><dt>Status</dt><dd><span className={`theme-workflow-status is-${item.status}${overdue ? ' is-overdue' : ''}`}>{item.status === 'done' ? 'Done' : 'Open'}{overdue ? ' · Overdue' : ''}</span></dd></div>
              </dl>
              <p>Decision: {item.decision}</p>
              <p className="theme-workflow-meta">Recorded at the {item.meetingDate} meeting.</p>
              <details><summary>History</summary><ul>{item.history.map((change, index) => <li key={index}>@{change.by} · {change.at} · {change.status}: {change.note}</li>)}</ul></details>
              <label>Progress / completion evidence <textarea required maxLength={2000} value={notes[item.id] || ''} onChange={(event) => setNotes({ ...notes, [item.id]: event.target.value })} /></label>
              <button className="ops-secondary" type="submit" aria-label={`Save progress for ${item.task}`}>Save</button>
              <button className="ops-secondary" type="button" disabled={!notes[item.id]?.trim()} onClick={() => void save({ operation: 'update_action', id: item.id, version: item.version, status: item.status === 'done' ? 'open' : 'done', note: notes[item.id] })}>{item.status === 'done' ? 'Reopen' : 'Mark done'}</button>
              {!notes[item.id]?.trim() && <p className="ops-muted-line">Add a note before changing completion status.</p>}
            </fieldset>
          </form>;
        })}
      </>}
    </div>
  </details>;
}

/** The current agenda (view, reorder, confirm, email) followed by decisions and actions for the theme. */
export function ThemeMeetingWorkflow({ themeId, meetingDate, meetingTime, cancelled, canAccess, fallbackItems, memberNames = {}, onChanged, children }: {
  themeId: string; meetingDate: string; meetingTime: string; cancelled: boolean; canAccess: boolean;
  fallbackItems: ThemeMeetingAgendaItem[]; memberNames?: Record<string, string>; onChanged: () => Promise<void> | void; children?: ReactNode;
}) {
  const [revision, setRevision] = useState(0);
  return <>
    <AgendaBoard themeId={themeId} meetingDate={meetingDate} meetingTime={meetingTime} cancelled={cancelled} canAccess={canAccess}
      fallbackItems={fallbackItems} revision={revision} onSaved={() => setRevision((value) => value + 1)} onChanged={onChanged} />
    {children}
    {canAccess && <FollowUp themeId={themeId} meetingDate={meetingDate} revision={revision} memberNames={memberNames} onChanged={onChanged} />}
  </>;
}
