import { formatMeetingProject, type MeetingProjectContext } from '../src/mastra/theme-meetings/project-context';

export function MeetingProjectSummary({ context }: { context?: MeetingProjectContext }) {
  if (!context) return <p>Project stage: Not linked</p>;
  return <div aria-label="Shared project snapshot" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{formatMeetingProject(context)}</div>;
}
