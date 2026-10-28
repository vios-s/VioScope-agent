import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { atomicWrite, contentHash, withFileLock } from '../atomic-file';
import { resolveThemeMeetingUpdatesPath, type ThemeMeetingStoreOptions } from './store';
import { themeMeetingAgendaItemSchema, type ThemeMeetingPlan } from './schema';

export const meetingDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(
  (value) => !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value,
  'Choose a valid date.',
);
const text = z.string().trim().min(1).max(2000);
const entrySchema = themeMeetingAgendaItemSchema.extend({ deferred: z.boolean() });
const confirmationSchema = z.object({
  meetingDate: meetingDateSchema, themeId: z.string(), version: z.number().int().positive(),
  confirmedBy: z.string(), confirmedAt: z.string().datetime(), entries: z.array(entrySchema),
});
const changeSchema = z.object({ by: z.string(), at: z.string().datetime(), status: z.enum(['open', 'done']), note: z.string() });
const actionSchema = z.object({
  id: z.string().uuid(), themeId: z.string(), meetingDate: meetingDateSchema,
  projectId: z.string().uuid().nullable().default(null),
  decision: text, task: text, owner: z.string(), dueDate: meetingDateSchema,
  status: z.enum(['open', 'done']), note: z.string().max(2000),
  history: z.array(changeSchema),
});
export const workflowSchema = z.object({ confirmations: z.array(confirmationSchema), actions: z.array(actionSchema) });
export type MeetingWorkflow = z.infer<typeof workflowSchema>;
export type MeetingAction = MeetingWorkflow['actions'][number];
export type AgendaConfirmation = MeetingWorkflow['confirmations'][number];
export const agendaSelectionSchema = z.array(z.object({
  username: z.string().trim().min(1), minutes: z.number().int().min(0).max(60), deferred: z.boolean(),
}).strict()).max(200);
export const newActionSchema = z.object({ projectId: z.string().uuid().nullable().default(null), decision: text, task: text, owner: z.string().trim().min(1), dueDate: meetingDateSchema }).strict();

export function workflowPath(options: ThemeMeetingStoreOptions = {}) {
  return `${resolveThemeMeetingUpdatesPath(options.updatesPath)}.workflow.json`;
}
export async function readMeetingWorkflow(options: ThemeMeetingStoreOptions = {}): Promise<MeetingWorkflow> {
  try { return workflowSchema.parse(JSON.parse(await readFile(workflowPath(options), 'utf8'))); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { confirmations: [], actions: [] };
    throw error;
  }
}
export async function changeMeetingWorkflow<T>(options: ThemeMeetingStoreOptions, change: (state: MeetingWorkflow) => Promise<T>): Promise<T> {
  return withFileLock(workflowPath(options), async () => {
    const state = await readMeetingWorkflow(options);
    const result = await change(state);
    await atomicWrite(workflowPath(options), JSON.stringify(workflowSchema.parse(state), null, 2) + '\n');
    return result;
  });
}
export function latestConfirmation(state: MeetingWorkflow, date: string, theme: string) {
  return state.confirmations.filter((item) => item.meetingDate === date && item.themeId === theme).at(-1) || null;
}
export function agendaSourceVersion(meeting: ThemeMeetingPlan['meetings'][number], confirmation: AgendaConfirmation | null) {
  return contentHash({ entries: meeting.agenda_items, members: meeting.member_usernames, cancelled: meeting.cancelled,
    duration: meeting.duration_minutes, version: confirmation?.version || 0 });
}
export function confirmAgenda(state: MeetingWorkflow, meeting: ThemeMeetingPlan['meetings'][number], date: string,
  selections: z.infer<typeof agendaSelectionSchema>, by: string): AgendaConfirmation {
  if (meeting.cancelled) throw new Error('Restore the cancelled meeting before confirming an agenda.');
  const selected = agendaSelectionSchema.parse(selections);
  const usernames = selected.map((item) => item.username);
  if (new Set(usernames).size !== usernames.length || selected.length !== meeting.agenda_items.length) {
    throw new Error('Review every submitted item exactly once. Refresh the agenda.');
  }
  const entries = selected.map((selection) => {
    const source = meeting.agenda_items.find((item) => item.member_username === selection.username);
    if (!source) throw new Error('The agenda changed. Refresh before confirming.');
    if ((source.update_type === 'nothing_to_report' && selection.minutes !== 0) ||
        (source.update_type !== 'nothing_to_report' && selection.minutes < 1)) throw new Error('Invalid slot duration.');
    if (source.update_type === 'short_update' && selection.minutes !== 5) throw new Error('Short updates are 5 minutes.');
    return { ...source, duration_minutes: selection.minutes, deferred: selection.deferred };
  });
  if (entries.filter((item) => !item.deferred).reduce((sum, item) => sum + item.duration_minutes, 0) > meeting.duration_minutes) {
    throw new Error('The agenda exceeds the meeting time. Shorten or defer an item.');
  }
  const record = confirmationSchema.parse({ meetingDate: date, themeId: meeting.theme_id,
    version: (latestConfirmation(state, date, meeting.theme_id)?.version || 0) + 1,
    confirmedBy: by, confirmedAt: new Date().toISOString(), entries });
  state.confirmations.push(record);
  return record;
}
export function applyConfirmedAgendas(plan: ThemeMeetingPlan, state: MeetingWorkflow): ThemeMeetingPlan {
  return { ...plan, meetings: plan.meetings.map((meeting) => {
    const saved = latestConfirmation(state, plan.meeting_date, meeting.theme_id);
    if (!saved || meeting.cancelled) return meeting;
    const agenda_items = saved.entries.filter((item) => !item.deferred).map(({ deferred: _, ...item }) => item);
    const planned_minutes = agenda_items.reduce((sum, item) => sum + item.duration_minutes, 0);
    return { ...meeting, agenda_items, planned_minutes, overbooked: planned_minutes > meeting.duration_minutes };
  }) };
}
export function addMeetingAction(state: MeetingWorkflow, themeId: string, meetingDate: string,
  input: z.infer<typeof newActionSchema>, by: string) {
  const data = newActionSchema.parse(input);
  if (data.dueDate < meetingDate) throw new Error('The due date cannot be before the meeting.');
  const action = actionSchema.parse({ ...data, id: randomUUID(), themeId, meetingDate, status: 'open', note: '',
    history: [{ by, at: new Date().toISOString(), status: 'open', note: 'Created' }] });
  state.actions.push(action);
  return action;
}
export function updateMeetingAction(action: MeetingAction, status: 'open' | 'done', note: string, by: string, canManage: boolean) {
  if (!canManage && action.owner !== by) throw new Error('Only the assignee or theme manager can update this action.');
  if (!note.trim()) throw new Error('Add a progress or completion note, including evidence where available.');
  const at = new Date().toISOString();
  const next = actionSchema.parse({ ...action, status, note: note.trim(), history: [...action.history, { by, at, status, note: note.trim() }] });
  Object.assign(action, next);
}
