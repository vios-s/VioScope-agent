import { z } from 'zod';
import type { ProjectRecord } from '../db/projects';

export const meetingProjectContextSchema = z.object({
  projectId: z.string().uuid(),
  title: z.string(),
  ownerUsername: z.string().min(1),
  actions: z.array(z.object({ id: z.string(), text: z.string(), dueDate: z.iso.date().nullable() })).max(100),
});
export type MeetingProjectContext = z.infer<typeof meetingProjectContextSchema>;

// The project owns live tasks; the submitted agenda retains the explicitly shared snapshot.
export function meetingProjectContext(project: Pick<ProjectRecord, 'id' | 'title' | 'ownerUsername' | 'todos'>): MeetingProjectContext {
  return { projectId: project.id, title: project.title, ownerUsername: project.ownerUsername,
    actions: project.todos.filter(item => !item.done).map(({ id, text, dueDate }) => ({ id, text, dueDate: dueDate && z.iso.date().safeParse(dueDate).success ? dueDate : null })) };
}

export function formatMeetingProject(context?: MeetingProjectContext): string {
  if (!context) return '';
  return [`Project: ${context.title}`, `Owner: @${context.ownerUsername}`,
    ...context.actions.map(action => `Next: ${action.text} | Due: ${action.dueDate || 'Not set'}`),
    ...(context.actions.length ? [] : ['No open project actions recorded.']),
  ].join('\n');
}
