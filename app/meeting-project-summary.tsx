import type { ReactNode } from 'react';
import type { MeetingProjectContext } from '../src/mastra/theme-meetings/project-context';
import { formatDay } from './format';

/** `title` may replace the plain project title, for example with a link to the project record. */
export function MeetingProjectSummary({ context, title }: { context?: MeetingProjectContext; title?: ReactNode }) {
  if (!context) return <p className="meeting-project-summary">Not linked to a project</p>;
  return (
    <dl className="meeting-project-summary" aria-label="Shared project snapshot">
      <div><dt>Project</dt><dd>{title ?? context.title}</dd></div>
      <div><dt>Owner</dt><dd>@{context.ownerUsername}</dd></div>
      <div><dt>Project stage</dt><dd>{context.stage ?? 'Not recorded'}</dd></div>
      <div><dt>Next actions</dt><dd>{context.actions.length
        ? <ul>{context.actions.map((action) => <li key={action.id}>{action.text}{action.dueDate ? ` · due ${formatDay(action.dueDate)}` : ''}</li>)}</ul>
        : 'None recorded'}</dd></div>
    </dl>
  );
}
