import { formatMeetingProject, type MeetingProjectContext } from '../src/mastra/theme-meetings/project-context';

export function MeetingProjectSummary({ context }: { context?: MeetingProjectContext }) {
  if (!context) return null;
  return <div aria-label="Shared project actions" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{formatMeetingProject(context)}</div>;
}
