'use client';
import { themeUpdateTypeLabels } from '../src/mastra/theme-meetings/schema';

import { MeetingProjectSummary } from './meeting-project-summary';
import { ConfirmDialog } from './confirm-dialog';
import { formatDay, formatDayTime } from './format';

import { useEffect, useMemo, useReducer, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Check, GripVertical, Mail, RotateCcw } from 'lucide-react';
import { ApiRequestError, requestJson } from './client-request';
import type { AgendaConfirmation, MeetingAction } from '../src/mastra/theme-meetings/workflow';
import type { ConfirmedAgendaEmailAudience } from '../src/mastra/theme-meetings/planner';
import type { ThemeMeetingAgendaItem } from '../src/mastra/theme-meetings/schema';

type Payload = {
  viewerId: string; viewerUsername?: string; manager: boolean;
  /** A coordinator viewing a meeting before the theme's current one: everything is shown, nothing can be changed. */
  readOnly?: boolean; cancelled: boolean; duration: number; sourceVersion: string; members: string[];
  candidates: ThemeMeetingAgendaItem[]; confirmation: AgendaConfirmation | null; emailedAt?: string | null;
  emailAudience?: ConfirmedAgendaEmailAudience | null;
  projects: Array<{ id: string; title: string }>;
  actions: Array<MeetingAction & { version: string; projectTitle: string | null }>;
};
type Selection = { username: string; minutes: number; deferred: boolean };
type Row = { item: ThemeMeetingAgendaItem; minutes: number; skipped: boolean };
type Drag = { username: string; from: number; to: number; dy: number; height: number };
/** Renders a project title as a link to its record when the viewer can open it, otherwise as plain text. */
type ProjectLink = (projectId: string | null | undefined, title: string, workflowTab?: 'tasks') => ReactNode;

const ukTime = (value: string) => formatDayTime(value);
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
const people = (count: number) => `${count} ${count === 1 ? 'person' : 'people'}`;

function emailDialogMessage(version: number, audience: ConfirmedAgendaEmailAudience | null | undefined, emailedAt?: string | null) {
  if (!audience || audience.version !== version) {
    return `Send confirmed version ${version} to theme members, the coordinator and agenda subscribers.${emailedAt ? ' This version was already emailed; people who received it will not get a duplicate.' : ''}`;
  }
  const total = audience.recipients.length;
  const already = audience.recipients.filter((recipient) => recipient.alreadySent).length;
  const fresh = total - already;
  return [
    audience.emailEnabled ? '' : 'Email delivery is switched off on this server, so nothing will be sent.',
    `Send version ${version} to ${people(total)} (theme members, the coordinator and agenda subscribers).`,
    audience.skipped ? `${people(audience.skipped)} will be skipped (no email address, inactive account or email notifications turned off).` : '',
    already ? (fresh ? `Already sent to ${already}; resending sends only to the ${people(fresh)} who have not received it.` : `Everyone has already received version ${version}; nothing new will be sent.`) : '',
  ].filter(Boolean).join(' ');
}
const sameSelections = (a: Selection[], b: Selection[]) => a.length === b.length &&
  a.every((entry, index) => entry.username === b[index].username && entry.minutes === b[index].minutes && entry.deferred === b[index].deferred);

// Last payload per account/theme/date so switching theme cards renders instantly from cache and then revalidates silently.
// Every entry is keyed by the signed-in account id; everything is cleared on logout and when another account loads.
const workflowCache = new Map<string, Payload>();
const workflowRequests = new Map<string, Promise<Payload>>();
// Unsaved agenda order per account/theme/date, used only while the server baseline (sourceVersion) is unchanged.
const unsavedOrders = new Map<string, { sourceVersion: string; entries: Selection[] }>();
let cacheUser = '';
let cacheEpoch = 0;
const cacheKey = (userId: string, themeId: string, date: string) => `${userId}|${themeId}|${date}`;

/** Drops every cached agenda, in-flight request and unsaved order. Call on logout. */
export function resetThemeMeetingWorkflowCache() {
  workflowCache.clear(); workflowRequests.clear(); unsavedOrders.clear();
  cacheUser = ''; cacheEpoch += 1;
}

/** `fresh` skips an in-flight request (which may predate a change) and always asks the server again. */
function loadWorkflow(userId: string, themeId: string, date: string, fresh = false): Promise<Payload> {
  if (cacheUser !== userId) { resetThemeMeetingWorkflowCache(); cacheUser = userId; }
  const key = cacheKey(userId, themeId, date);
  const pending = workflowRequests.get(key);
  if (pending && !fresh) return pending;
  const epoch = cacheEpoch;
  const request = requestJson<Payload>(`/api/theme-meetings/workflow?${new URLSearchParams({ meetingDate: date, themeId })}`, 'Could not load meeting workflow.')
    .then((payload) => {
      // Apply a response only to the account that asked for it, and never after a logout.
      if (payload.viewerId !== userId || epoch !== cacheEpoch) throw new Error('Your session changed. Reload the page.');
      workflowCache.set(key, payload); return payload;
    }, (caught) => { workflowCache.delete(key); throw caught; })
    .finally(() => { if (workflowRequests.get(key) === request) workflowRequests.delete(key); });
  workflowRequests.set(key, request);
  return request;
}

function useWorkflow(userId: string, themeId: string, date: string, revision: number | string, enabled = true) {
  const key = cacheKey(userId, themeId, date);
  const [state, setState] = useState<{ key: string; data: Payload | null; error: string }>(() => ({ key, data: workflowCache.get(key) || null, error: '' }));
  const loadedKey = useRef('');
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    // A new key may reuse an in-flight prefetch; a new revision for the same key always fetches fresh data.
    const fresh = loadedKey.current === key;
    loadedKey.current = key;
    // Show the latest cached payload for this key at once (or none while loading), never another theme's or account's payload.
    setState((current) => current.key === key ? { key, data: workflowCache.get(key) || current.data, error: '' } : { key, data: workflowCache.get(key) || null, error: '' });
    void loadWorkflow(userId, themeId, date, fresh)
      .then((payload) => { if (active) setState({ key, data: payload, error: '' }); })
      .catch((caught) => { if (active) setState({ key, data: null, error: caught instanceof Error ? caught.message : 'Could not load.' }); });
    return () => { active = false; };
  }, [key, userId, themeId, date, revision, enabled]);
  return state.key === key ? { data: state.data, error: state.error } : { data: workflowCache.get(key) || null, error: '' };
}

// Tells a manager what changed when a confirmation was rejected as stale.
function describeChanges(before: Payload, after: Payload) {
  const byName = (payload: Payload) => new Map(payload.candidates.map((item) => [item.member_username || item.member, item]));
  const was = byName(before);
  const now = byName(after);
  const names = (list: ThemeMeetingAgendaItem[]) => list.map((item) => item.member).join(', ');
  const added = [...now.values()].filter((item) => !was.has(item.member_username || item.member));
  const removed = [...was.values()].filter((item) => !now.has(item.member_username || item.member));
  const edited = [...now.values()].filter((item) => { const old = was.get(item.member_username || item.member); return old && old.submitted_at !== item.submitted_at; });
  const parts = [
    added.length ? `new submissions from ${names(added)}` : '',
    removed.length ? `${names(removed)} no longer on the agenda` : '',
    edited.length ? `updated submissions from ${names(edited)}` : '',
    before.members.join() !== after.members.join() ? 'theme membership changed' : '',
    (after.confirmation?.version || 0) !== (before.confirmation?.version || 0) && after.confirmation
      ? `version ${after.confirmation.version} was confirmed by @${after.confirmation.confirmedBy}` : '',
    after.cancelled && !before.cancelled ? 'the meeting was skipped' : '',
  ].filter(Boolean);
  return `The agenda changed while you were reviewing it${parts.length ? `: ${parts.join('; ')}` : ''}. It has been reloaded and any unsaved order was reset; review it and confirm again.`;
}

const validMinutes = (minutes: number) => Number.isInteger(minutes) && minutes >= 1 && minutes <= 60;
const countable = (minutes: number) => (Number.isFinite(minutes) ? minutes : 0);

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
    // Per-item skipping was retired: a new version always schedules every submission (older deferred entries stay read-only).
    return { username: item.member_username || '', deferred: false,
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

function ItemSummary({ item, projectLink }: { item: ThemeMeetingAgendaItem; projectLink: ProjectLink }) {
  return <span className="mt-item-main">
    <strong>{item.project_context?.title || item.member}</strong>
    <span>{item.project_context ? `${item.member} · Project stage ${item.project_context.stage ?? 'not recorded'}` : 'No linked project'}</span>
    {item.project_context && <details className="mt-snapshot"><summary>Project snapshot</summary>
      <MeetingProjectSummary context={item.project_context} title={projectLink(item.project_context.projectId, item.project_context.title)} /></details>}
  </span>;
}

function AgendaBoard({ userId, themeId, meetingDate, meetingTime, cancelled, canAccess, fallbackItems, revision, onSaved, onChanged, projectLink, draftNote }: {
  userId: string; themeId: string; meetingDate: string; meetingTime: string; cancelled: boolean; canAccess: boolean;
  fallbackItems: ThemeMeetingAgendaItem[]; revision: number | string; onSaved: () => void; onChanged: () => Promise<void> | void; projectLink: ProjectLink;
  /** Shown to members while the agenda is a draft, because they see only their own submission. */
  draftNote?: string;
}) {
  const { data, error } = useWorkflow(userId, themeId, meetingDate, revision, canAccess);
  // Local order and minutes live in unsavedOrders (kept across card switches); nothing is saved until Confirm.
  // A stored order is used only for the server baseline it was made on and only while every entry is still a candidate.
  const orderKey = cacheKey(userId, themeId, meetingDate);
  const sourceVersion = data?.sourceVersion || '';
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  const stored = unsavedOrders.get(orderKey);
  const orderValid = Boolean(stored && data && stored.sourceVersion === data.sourceVersion && stored.entries.length === data.candidates.length
    && stored.entries.every((entry) => data.candidates.some((item) => item.member_username === entry.username)));
  const edited = orderValid ? stored!.entries : null;
  const setEdited = (next: Selection[] | null) => {
    if (next && sourceVersion) unsavedOrders.set(orderKey, { sourceVersion, entries: next }); else unsavedOrders.delete(orderKey);
    rerender();
  };
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const [dialog, setDialog] = useState<'confirm' | 'email' | null>(null);
  const [dialogError, setDialogError] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const [drag, setDrag] = useState<Drag | null>(null);
  const listRef = useRef<HTMLOListElement | null>(null);
  const dragRef = useRef<{ drag: Drag; mids: number[]; startY: number; clientY: number; scroller: HTMLElement; frame: number } | null>(null);
  const baseline = useMemo(() => data ? initialSelections(data) : [], [data]);
  useEffect(() => { setDialog(null); setMessage(null); }, [themeId, meetingDate, cancelled]);
  useEffect(() => { setDialogError(''); }, [dialog]);
  // The submissions or members changed under an unsaved order: drop it and say so.
  useEffect(() => {
    if (!data || !stored || orderValid) return;
    unsavedOrders.delete(orderKey);
    setMessage({ error: false, text: 'Your unsaved order was discarded because the submissions or theme members changed. Review the updated agenda.' });
    rerender();
  }, [data, stored, orderValid, orderKey]);
  useEffect(() => () => { if (dragRef.current) cancelAnimationFrame(dragRef.current.frame); }, []);
  if (cancelled) return null;

  const manager = Boolean(data?.manager);
  const readOnly = Boolean(data?.readOnly);
  const canEdit = manager && !readOnly;
  const editable = Boolean(canEdit && data && data.candidates.length);
  const entries = edited ?? baseline;
  const dirty = Boolean(edited && !sameSelections(edited, baseline));
  const confirmation = data?.confirmation || null;
  const candidate = (username: string) => data!.candidates.find((item) => item.member_username === username)!;
  const rows: Row[] = editable
    ? entries.map((entry) => ({ item: candidate(entry.username), minutes: entry.minutes, skipped: entry.deferred }))
    : confirmation
      ? confirmation.entries.map((entry) => ({ item: entry, minutes: entry.duration_minutes, skipped: entry.deferred }))
      // Members and managers wait for their workflow payload (never the plan fallback, which would flash a draft).
      : (canAccess ? data?.candidates || [] : fallbackItems).map((item) => ({ item, minutes: item.duration_minutes, skipped: false }));
  const loading = canAccess && !data;
  const scheduled = rows.filter((row) => !row.skipped);
  const skipped = rows.filter((row) => row.skipped);
  const starts = startTimes(meetingTime, scheduled.map((row) => countable(row.minutes)));
  const duration = data?.duration || 60;
  const total = scheduled.reduce((sum, row) => sum + countable(row.minutes), 0);
  const over = total > duration;
  const minutesInvalid = editable && scheduled.some((row) => row.item.update_type !== 'nothing_to_report' && !validMinutes(row.minutes));
  const changedSinceConfirmation = Boolean(canEdit && confirmation && (confirmation.entries.length !== data!.candidates.length ||
    data!.candidates.some((item) => !confirmation.entries.some((entry) => entry.member_username === item.member_username && entry.submitted_at === item.submitted_at))));
  const confirmedSelections = (confirmation?.entries || []).map((entry) => ({ username: entry.member_username || '', minutes: entry.duration_minutes, deferred: entry.deferred }));
  const upToDate = Boolean(confirmation && !changedSinceConfirmation && sameSelections(entries, confirmedSelections));
  const nextVersion = (confirmation?.version || 0) + 1;
  const scheduledNames = scheduled.map((row) => row.item.member_username || row.item.member);
  // Read-only trace of retired per-item skipping in the latest confirmed version.
  const legacyDeferred = (confirmation?.entries || []).filter((entry) => entry.deferred).map((entry) => entry.member);

  const update = (username: string, patch: Partial<Selection>) => setEdited(entries.map((entry) => entry.username === username ? { ...entry, ...patch } : entry));
  function reorder(from: number, to: number) {
    if (from === to || to < 0 || to >= scheduledNames.length) return;
    const order = [...scheduledNames];
    const [moved] = order.splice(from, 1);
    order.splice(to, 0, moved);
    const byName = new Map(entries.map((entry) => [entry.username, entry]));
    setEdited(order.map((name) => byName.get(name)!));
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
  // Errors stay inside the open dialog; a stale (409) agenda closes it, reloads and explains what changed.
  async function confirm() {
    if (!data) return;
    setBusy(true); setMessage(null); setDialogError('');
    try {
      await post({ operation: 'confirm', sourceVersion: data.sourceVersion, entries }, 'Could not confirm the agenda.');
      // The confirmed order is now the saved baseline, not an unsaved order to discard when the data reloads.
      unsavedOrders.delete(orderKey);
      setMessage({ error: false, text: `Version ${nextVersion} confirmed. Email it when you are ready.` });
      setDialog(null);
      onSaved();
      await onChanged();
    } catch (caught) {
      const text = caught instanceof Error ? caught.message : 'Could not confirm the agenda.';
      if (!(caught instanceof ApiRequestError && caught.status === 409)) { setDialogError(text); return; }
      setDialog(null);
      unsavedOrders.delete(orderKey);
      try { setMessage({ error: true, text: describeChanges(data, await loadWorkflow(userId, themeId, meetingDate, true)) }); }
      catch { setMessage({ error: true, text: `${text} Reload the page to review the latest agenda.` }); }
      onSaved();
      await onChanged();
    } finally { setBusy(false); }
  }
  async function sendEmail() {
    if (!confirmation) return;
    setBusy(true); setMessage(null); setDialogError('');
    try {
      const result = await post({ operation: 'email_confirmed', version: confirmation.version }, 'Could not email the agenda.');
      const emails = result.emails || { sent: 0, skipped: 0, failed: 0 };
      setMessage({ error: emails.failed > 0, text: `Version ${confirmation.version} emailed: ${emails.sent} sent, ${emails.skipped} skipped, ${emails.failed} failed.${emails.skipped ? ' Skipped recipients already received this version, have agenda emails switched off or have no email address.' : ''}` });
      setDialog(null);
      onSaved();
    } catch (caught) {
      const text = caught instanceof Error ? caught.message : 'Could not email the agenda.';
      if (!(caught instanceof ApiRequestError && caught.status === 409)) { setDialogError(text); return; }
      setDialog(null); setMessage({ error: true, text }); onSaved();
    } finally { setBusy(false); }
  }

  function row({ item, minutes, skipped: isSkipped }: Row, start: string, index: number) {
    const username = item.member_username || item.member;
    const fixed = item.update_type !== 'deep_dive';
    const dragging = drag?.username === username;
    return <li key={username} className={`${isSkipped ? 'is-skipped' : ''}${dragging ? ' is-dragging' : ''}`} style={isSkipped ? undefined : shift(index)}>
      {editable && (<button className="mt-drag-handle" type="button" data-agenda-handle={username}
        aria-label={`Reorder ${item.member}, position ${index + 1} of ${scheduled.length}`} aria-describedby={`mt-drag-hint-${themeId}`} disabled={busy}
        onPointerDown={(event) => startDrag(event, username)} onPointerMove={moveDrag} onPointerUp={() => endDrag(true)} onPointerCancel={() => endDrag(false)}
        onLostPointerCapture={() => endDrag(true)} onKeyDown={(event) => onHandleKey(event, username)}>
        <GripVertical aria-hidden="true" /></button>)}
      <time className="vs-mono" aria-label={start ? `Planned start ${start}` : undefined}>{isSkipped ? '—' : start}</time>
      <ItemSummary item={item} projectLink={projectLink} />
      {editable ? <span className="mt-arrange-controls">
        <span className={`mt-slot mt-slot-${item.update_type}`}>{themeUpdateTypeLabels[item.update_type]}</span>
        {fixed ? <span className="mt-minutes-text" title={`${themeUpdateTypeLabels[item.update_type]} slots are fixed at ${minutes} minutes`}>{minutes} min</span> : <label className="mt-minutes" title="Deep Dive minutes can be edited (1–60)">
          <input type="number" inputMode="numeric" step={1} min={1} max={60} required value={Number.isFinite(minutes) ? minutes : ''}
            disabled={busy} aria-label={`Minutes for ${item.member}`}
            aria-invalid={!validMinutes(minutes) ? true : undefined}
            onChange={(event) => update(username, { minutes: event.target.value === '' ? Number.NaN : Math.round(Number(event.target.value)) })} />
          <span aria-hidden="true">min</span></label>}
      </span> : <span className={`mt-slot mt-slot-${item.update_type}`}>{themeUpdateTypeLabels[item.update_type]}{isSkipped ? '' : ` · ${minutes} min`}</span>}
    </li>;
  }

  const emailHintId = `mt-email-hint-${themeId}`;
  const minutesHintId = `mt-minutes-hint-${themeId}`;
  return <div className={`mt-board${editable ? ' is-editable' : ''}`} aria-busy={busy}>
    <div className="mt-board-bar">
      <p className={`mt-board-state ${loading || !canAccess ? 'is-loading' : confirmation ? 'is-confirmed' : 'is-draft'}`}>
        {loading ? <strong>{error ? 'Agenda unavailable' : 'Loading agenda…'}</strong>
          // Without workflow access the confirmation state is unknown, so never label the plan a draft.
          : !canAccess ? <><strong>Planned agenda</strong> · Confirmation details are shown to theme members and managers.</> : confirmation ? <><strong>Confirmed</strong> · Version {confirmation.version} by @{confirmation.confirmedBy}, {ukTime(confirmation.confirmedAt)} (UK time){manager ? (data?.emailedAt ? ` · Emailed ${ukTime(data.emailedAt)}` : ' · Not emailed yet') : ''}</>
          : <><strong>Draft</strong> · From submitted updates; not yet confirmed by the coordinator.</>}
      </p>
      {dirty && <p className="mt-unsaved" role="status"><strong>Unsaved order</strong>
        <button className="mt-link-btn" type="button" disabled={busy} onClick={() => { setEdited(null); setAnnouncement('Order reset.'); }} aria-label="Reset agenda to the saved order">
          <RotateCcw aria-hidden="true" />Reset</button></p>}
    </div>
    {error && <p className="form-message error" role="alert">{error}</p>}
    {changedSinceConfirmation && <p className="mt-board-note" role="note">Submissions changed after version {confirmation!.version} was confirmed. This draft includes them; confirm again to save version {nextVersion}.</p>}
    {editable && legacyDeferred.length > 0 && <p className="mt-board-note is-subtle" role="note">Deferred in an earlier version: {legacyDeferred.join(', ')}. A new version schedules every submitted update; adjust Deep Dive minutes instead.</p>}
    {!changedSinceConfirmation && confirmation && editable && !upToDate && <p className="mt-board-note is-subtle" role="note">This draft differs from confirmed version {confirmation.version}. Email still sends version {confirmation.version} until you confirm again.</p>}
    {message && <p className={`form-message${message.error ? ' error' : ''}`} role={message.error ? 'alert' : 'status'}>{message.text}</p>}
    {editable && <p id={`mt-drag-hint-${themeId}`} className="mt-board-hint">Drag or use the arrow keys to reorder.</p>}
    <p className="vs-sr-only" aria-live="polite">{announcement}</p>
    {loading ? (!error && <ol className="mt-agenda-list is-loading" role="status" aria-label="Loading agenda…">
      {Array.from({ length: Math.max(1, fallbackItems.length) }, (_, index) => <li key={index} aria-hidden="true">
        <span className="mt-skeleton is-time" /><span className="mt-item-main"><span className="mt-skeleton is-title" /><span className="mt-skeleton is-meta" /></span>
        <span className="mt-skeleton is-slot" /></li>)}
    </ol>) : scheduled.length ? <ol ref={listRef} className={`mt-agenda-list${drag ? ' is-sorting' : ''}`} aria-label="Agenda">{scheduled.map((item, index) => row(item, starts[index], index))}</ol>
      : !(draftNote && !manager && !confirmation) && <p className="mt-agenda-empty">{rows.length ? 'No items are scheduled.' : 'No planned updates yet'}</p>}
    {!loading && draftNote && !manager && !confirmation && <p className="mt-agenda-empty">{draftNote}</p>}
    {skipped.length > 0 && <section className="mt-skipped" aria-label="Deferred items">
      <h3>Deferred in an earlier version · not scheduled</h3>
      <ul className="mt-agenda-list">{skipped.map((item, index) => row(item, '', index))}</ul>
    </section>}
    {canEdit && <div className="mt-arrange-footer">
      <div className={`mt-arrange-total${over ? ' is-over' : ''}`} role="status">
        <span className={`mt-meter${over ? ' is-over' : ''}`} aria-hidden="true"><span style={{ width: `${Math.min(100, Math.round((total / duration) * 100))}%` }} /></span>
        <span className="mt-num">{total} of {duration} min{over ? ` · ${total - duration} min over. Shorten Deep Dive minutes.` : ` · ${duration - total} min free`}</span>
      </div>
      <div className="mt-arrange-buttons">
        <button className="ops-primary" type="button" disabled={busy || over || !editable || upToDate || minutesInvalid} onClick={() => setDialog('confirm')}
          aria-label={`Confirm the agenda as version ${nextVersion}`} aria-describedby={minutesInvalid ? minutesHintId : undefined}
          title={upToDate ? `Version ${confirmation!.version} is already confirmed` : undefined}>
          <Check aria-hidden="true" />Confirm</button>
        <button className="ops-secondary" type="button" disabled={busy || !confirmation} onClick={() => setDialog('email')}
          aria-label={confirmation ? `Email confirmed agenda version ${confirmation.version}` : 'Email the agenda'} aria-describedby={confirmation ? undefined : emailHintId}
          title={confirmation ? undefined : 'Confirm the agenda first'}>
          <Mail aria-hidden="true" />Email</button>
      </div>
      {minutesInvalid && <p id={minutesHintId} className="mt-email-hint">Enter whole minutes from 1 to 60 for every Deep Dive.</p>}
      {!confirmation && <p id={emailHintId} className="vs-sr-only">Confirm the agenda first.</p>}
    </div>}
    <ConfirmDialog id={`mt-confirm-agenda-${themeId}`} open={dialog === 'confirm'} tone="default" title="Confirm this agenda?"
      message={`This saves version ${nextVersion} with ${plural(scheduled.length, 'item')} (${total} of ${duration} minutes). Emailing the agenda is a separate step.`}
      confirmLabel="Confirm" cancelLabel="Cancel" busy={busy} onCancel={() => setDialog(null)} onConfirm={() => void confirm()}>
      {dialogError && <p className="form-message error" role="alert">{dialogError}</p>}
    </ConfirmDialog>
    <ConfirmDialog id={`mt-email-agenda-${themeId}`} open={dialog === 'email'} tone="default" title="Email this agenda?"
      message={confirmation ? emailDialogMessage(confirmation.version, data?.emailAudience, data?.emailedAt) : ''}
      confirmLabel="Email" cancelLabel="Cancel" busy={busy} onCancel={() => setDialog(null)} onConfirm={() => void sendEmail()}
      confirmDisabled={Boolean(confirmation && data?.emailAudience?.version === confirmation.version && data.emailAudience.recipients.length > 0 && data.emailAudience.recipients.every((recipient) => recipient.alreadySent))}>
      {dialogError && <p className="form-message error" role="alert">{dialogError}</p>}
      {confirmation && data?.emailAudience?.version === confirmation.version && data.emailAudience.recipients.length > 0 && <details className="mt-email-recipients">
        <summary>Recipients ({data.emailAudience.recipients.length})</summary>
        <ul>{data.emailAudience.recipients.map((recipient) => <li key={recipient.username}>
          {recipient.displayName} <span className="vs-mono">@{recipient.username}</span>{recipient.alreadySent && <em> · already sent</em>}</li>)}</ul>
      </details>}
    </ConfirmDialog>
  </div>;
}

function FollowUp({ userId, themeId, meetingDate, revision, memberNames, onChanged, projectLink, recordsRequest }: {
  userId: string; themeId: string; meetingDate: string; revision: string; memberNames: Record<string, string>; onChanged: () => Promise<void> | void; projectLink: ProjectLink;
  recordsRequest?: RecordsRequest;
}) {
  const [date, setDate] = useState(meetingDate);
  const detailsRef = useRef<HTMLDetailsElement | null>(null);
  // A Past meetings row asks to show that meeting's records here.
  useEffect(() => {
    if (!recordsRequest || !detailsRef.current) return;
    setDate(recordsRequest.date);
    detailsRef.current.open = true;
    detailsRef.current.scrollIntoView({ block: 'start', behavior: 'smooth' });
    detailsRef.current.querySelector('summary')?.focus({ preventScroll: true });
  }, [recordsRequest]);
  const [local, setLocal] = useState(0);
  const { data, error } = useWorkflow(userId, themeId, date, `${revision}|${local}`);
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
  return <details className="theme-workflow" id={`theme-workflow-${themeId}`} ref={detailsRef}>
    <summary>Decisions &amp; actions{data ? ` · ${open.length} open` : ''}</summary>
    <div className="theme-workflow-body" aria-busy={busy}>
      <div className="theme-workflow-date">
        <label>Meeting date <input type="date" value={date} disabled={busy} onChange={(event) => { if (event.target.value) setDate(event.target.value); }} /></label>
        {date !== meetingDate && <button className="mt-link-btn" type="button" disabled={busy} onClick={() => setDate(meetingDate)}>Back to {formatDay(meetingDate)}</button>}
      </div>
      {(error || failure) && <p className="form-message error" role="alert">{failure || error} <button className="ops-secondary" type="button" disabled={busy} onClick={() => setLocal((value) => value + 1)}>Reload</button></p>}
      {status && <p className="form-message" role="status">{status}</p>}
      {!data ? <p className="ops-muted-line" role="status">{error ? 'Meeting records unavailable.' : 'Loading meeting records…'}</p> : <>
        {date !== meetingDate && <>
          <p className={`theme-workflow-state ${data.confirmation ? 'is-confirmed' : 'is-draft'}`}>{data.confirmation ? `Confirmed version ${data.confirmation.version} by @${data.confirmation.confirmedBy}, ${ukTime(data.confirmation.confirmedAt)}` : `No confirmed agenda for ${formatDay(date)}.`}</p>
          {data.confirmation && <ol className="theme-workflow-confirmed">{data.confirmation.entries.map((entry) => <li key={entry.member_username || entry.member}>
            <strong>{entry.member}</strong> <span>{themeUpdateTypeLabels[entry.update_type]} · {entry.duration_minutes} min{entry.deferred ? ' · Deferred, not scheduled' : ''}</span>
            <MeetingProjectSummary context={entry.project_context} />
          </li>)}</ol>}
        </>}
        {data.manager && data.readOnly && <p className="ops-muted-line" role="note">Past meetings are read-only.</p>}
        {data.manager && !data.readOnly && !data.confirmation && !data.cancelled && <p className="ops-muted-line">Confirm the agenda before recording decisions and actions.</p>}
        {data.manager && !data.readOnly && data.confirmation && !data.cancelled && <form className="theme-workflow-panel" onSubmit={(event) => { event.preventDefault(); void save({ operation: 'add_action', action: { ...action, projectId: action.projectId || null } }); }}>
          <fieldset disabled={busy}><legend>Record a decision and action</legend>
            <label>Decision <textarea required maxLength={2000} value={action.decision} onChange={(event) => setAction({ ...action, decision: event.target.value })} /></label>
            <label>Next action <textarea required maxLength={2000} value={action.task} onChange={(event) => setAction({ ...action, task: event.target.value })} /></label>
            <div className="theme-workflow-fields">
              <label>Responsible member <select required value={action.owner} onChange={(event) => setAction({ ...action, owner: event.target.value })}><option value="">Choose member</option>{data.members.map((member) => <option key={member} value={member}>{person(member)}</option>)}</select></label>
              <label>Linked project (optional) <select value={action.projectId} aria-describedby={`theme-action-project-help-${themeId}`} onChange={(event) => setAction({ ...action, projectId: event.target.value })}>
                <option value="">No project — group action</option>{data.projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}
              </select><small id={`theme-action-project-help-${themeId}`} className="theme-workflow-help">Linking grants no access.</small></label>
              <label>Due date <input required type="date" min={date} value={action.dueDate} onChange={(event) => setAction({ ...action, dueDate: event.target.value })} /></label>
            </div>
            <button className="ops-primary" type="submit">Add action</button>
          </fieldset>
        </form>}
        <h4 className="theme-workflow-heading">Actions · {open.length} open</h4>
        {!data.actions.length && <p className="ops-muted-line">No recorded actions.</p>}
        {data.actions.slice().sort((a, b) => a.status.localeCompare(b.status) * -1 || a.dueDate.localeCompare(b.dueDate)).map((item) => {
          const overdue = item.status === 'open' && item.dueDate < today;
          // On a past meeting a coordinator may update only actions assigned to them.
          const updatable = (data.manager && !data.readOnly) || item.owner === data.viewerUsername;
          return <form key={item.id} className="theme-workflow-action"
            onSubmit={(event) => { event.preventDefault(); void save({ operation: 'update_action', id: item.id, version: item.version, status: item.status, note: notes[item.id] || '' }); }}>
            <fieldset disabled={busy}><legend>{item.task}</legend>
              <dl className="theme-workflow-facts">
                <div><dt>Responsible</dt><dd>{person(item.owner)}</dd></div>
                <div><dt>Project</dt><dd>{item.projectTitle ? <>{projectLink(item.projectId, item.projectTitle, 'tasks')} <span className="theme-workflow-where">· Project tasks</span></> : 'No project — group action'}</dd></div>
                <div><dt>Due</dt><dd>{formatDay(item.dueDate)}</dd></div>
                <div><dt>Status</dt><dd><span className={`theme-workflow-status is-${item.status}${overdue ? ' is-overdue' : ''}`}>{item.status === 'done' ? 'Done' : 'Open'}{overdue ? ' · Overdue' : ''}</span></dd></div>
              </dl>
              <p>Decision: {item.decision}</p>
              <p className="theme-workflow-meta">Recorded at the {formatDay(item.meetingDate)} meeting.</p>
              <details><summary>History</summary><ul>{item.history.map((change, index) => <li key={index}>@{change.by} · {formatDayTime(change.at)} · {change.status === 'done' ? 'Done' : 'Open'}: {change.note}</li>)}</ul></details>
              {updatable && <>
              <label>Progress note <textarea required maxLength={2000} value={notes[item.id] || ''} onChange={(event) => setNotes({ ...notes, [item.id]: event.target.value })} /></label>
              <button className="ops-secondary" type="submit" aria-label={`Save note for ${item.task}`}>Save note</button>
              <button className="ops-secondary" type="button" disabled={!notes[item.id]?.trim()} onClick={() => void save({ operation: 'update_action', id: item.id, version: item.version, status: item.status === 'done' ? 'open' : 'done', note: notes[item.id] })}>{item.status === 'done' ? 'Reopen' : 'Mark done'}</button>
              {!notes[item.id]?.trim() && <p className="ops-muted-line">Add a note to mark it {item.status === 'done' ? 'open' : 'done'}.</p>}
              </>}
            </fieldset>
          </form>;
        })}
      </>}
    </div>
  </details>;
}

/** The current agenda (view, reorder, confirm, email) followed by decisions and actions for the theme. */
export type RecordsRequest = { date: string; nonce: number };

export function ThemeMeetingWorkflow({ userId, planRevision = '', themeId, meetingDate, meetingTime, cancelled, canAccess, fallbackItems, memberNames = {}, onChanged, children,
  onOpenProject, openableProjectIds = [], prefetchThemeIds = [], draftNote, recordsRequest }: {
  /** Signed-in account id: every cached agenda and unsaved order is keyed by it. */
  userId: string;
  /** Changes whenever the parent reloads the meeting plan (submissions, members, skip/restore), so the board refetches. */
  planRevision?: string;
  themeId: string; meetingDate: string; meetingTime: string; cancelled: boolean; canAccess: boolean;
  fallbackItems: ThemeMeetingAgendaItem[]; memberNames?: Record<string, string>; onChanged: () => Promise<void> | void; children?: ReactNode;
  /** Opens a project record; links render only for projects in the viewer's own project list. */
  onOpenProject?: (projectId: string, workflowTab?: 'tasks') => void; openableProjectIds?: string[];
  /** Other accessible themes on this date whose payload is fetched in the background so switching cards is instant. */
  prefetchThemeIds?: string[];
  /** Members see only their own draft row; this sentence tells them how many updates are planned and when the draft is shared. */
  draftNote?: string;
  /** Set by a Past meetings row to open Decisions & actions at that date. */
  recordsRequest?: RecordsRequest;
}) {
  const [revision, setRevision] = useState(0);
  const prefetchKey = prefetchThemeIds.join('|');
  useEffect(() => {
    for (const id of prefetchKey.split('|')) {
      if (id && id !== themeId && !workflowCache.has(cacheKey(userId, id, meetingDate))) void loadWorkflow(userId, id, meetingDate).catch(() => undefined);
    }
  }, [prefetchKey, userId, themeId, meetingDate]);
  const projectLink: ProjectLink = (projectId, title, workflowTab) => onOpenProject && projectId && openableProjectIds.includes(projectId)
    ? <button className="mt-project-link" type="button" aria-label={`Open project ${title}${workflowTab ? ' at Project tasks' : ''}`} onClick={() => onOpenProject(projectId, workflowTab)}>{title}</button>
    : title;
  const boardRevision = `${planRevision}|${revision}`;
  return <>
    <AgendaBoard userId={userId} themeId={themeId} meetingDate={meetingDate} meetingTime={meetingTime} cancelled={cancelled} canAccess={canAccess}
      fallbackItems={fallbackItems} revision={boardRevision} onSaved={() => setRevision((value) => value + 1)} onChanged={onChanged} projectLink={projectLink} draftNote={draftNote} />
    {children}
    {canAccess && <FollowUp userId={userId} themeId={themeId} meetingDate={meetingDate} revision={boardRevision} memberNames={memberNames} onChanged={onChanged} projectLink={projectLink} recordsRequest={recordsRequest} />}
  </>;
}
