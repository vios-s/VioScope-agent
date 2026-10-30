import { z } from 'zod';
import type { ProjectRecord } from '../db/projects';
import { formatDay } from '../../../app/format';

export const meetingProjectContextSchema = z.object({
  projectId: z.string().uuid(),
  title: z.string(),
  stage: z.number().int().min(1).max(5).optional(),
  ownerUsername: z.string().min(1),
  actions: z.array(z.object({ id: z.string(), text: z.string(), dueDate: z.iso.date().nullable() })).max(100),
});
export type MeetingProjectContext = z.infer<typeof meetingProjectContextSchema>;

// The project owns the live stage and tasks; the submitted agenda retains the explicitly shared snapshot.
export function meetingProjectContext(project: Pick<ProjectRecord, 'id' | 'title' | 'ownerUsername' | 'todos' | 'stage'>): MeetingProjectContext {
  return { projectId: project.id, title: project.title, stage: project.stage, ownerUsername: project.ownerUsername,
    actions: project.todos.filter(item => !item.done).map(({ id, text, dueDate }) => ({ id, text, dueDate: dueDate && z.iso.date().safeParse(dueDate).success ? dueDate : null })) };
}

export function formatMeetingProject(context?: MeetingProjectContext): string {
  if (!context) return '';
  return [`Project: ${context.title}`, `Owner: @${context.ownerUsername}`,
    `Project stage: ${context.stage === undefined ? 'Not recorded' : context.stage}`,
    ...context.actions.map(action => `Next: ${action.text} | Due: ${action.dueDate ? formatDay(action.dueDate) : 'Not set'}`),
    ...(context.actions.length ? [] : ['No open project actions recorded.']),
  ].join('\n');
}
