'use client';

import { useEffect, useState } from 'react';
import { requestJson } from './client-request';
import type { MeetingAction } from '../src/mastra/theme-meetings/workflow';

export function ProjectMeetingActions({ projectId }: { projectId: string }) {
  const [actions, setActions] = useState<MeetingAction[] | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setActions(null); setError('');
    void requestJson<{ actions: MeetingAction[] }>(`/api/projects/${encodeURIComponent(projectId)}/meeting-actions`, 'Could not load meeting actions.')
      .then((data) => { if (active) setActions(data.actions); })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : 'Could not load meeting actions.'); });
    return () => { active = false; };
  }, [projectId, revision]);
  return <section className="project-meeting-panel">
    <h2>Meeting decisions and actions</h2>
    <p>Update these actions in Meetings → Decisions and follow-up.</p>
    <button type="button" className="ops-secondary" onClick={() => setRevision((value) => value + 1)}>Refresh meeting actions</button>
    {error ? <p role="alert">{error}</p> : actions === null ? <p role="status">Loading meeting actions…</p> : !actions.length ? <p>No meeting actions linked to this project.</p> :
      <ul>{actions.slice().sort((a, b) => a.status.localeCompare(b.status) * -1 || a.dueDate.localeCompare(b.dueDate)).map((action) => <li key={action.id}>
        <strong>{action.task}</strong>
        <p>Theme {action.themeId} · Meeting {action.meetingDate} · @{action.owner} · Due {action.dueDate} · {action.status}</p>
        <p>Decision: {action.decision}</p>
        {action.note && <p>Latest progress: {action.note}</p>}
        <details><summary>History</summary><ul>{action.history.map((change, index) => <li key={index}>@{change.by} · {change.at} · {change.status}: {change.note}</li>)}</ul></details>
      </li>)}</ul>}
  </section>;
}
