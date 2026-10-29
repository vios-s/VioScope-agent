import { formatMeetingProject, type MeetingProjectContext } from '../src/mastra/theme-meetings/project-context';

export function MeetingProjectSummary({ context }: { context?: MeetingProjectContext }) {
  if (!context) return <p className="meeting-project-summary">Project stage: Not linked</p>;
  return <div className="meeting-project-summary" aria-label="Shared project snapshot">{formatMeetingProject(context)}</div>;
}
