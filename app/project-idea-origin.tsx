'use client';
import { useEffect, useState } from 'react';
import { requestJson } from './client-request';
import { formatDayTime } from './format';
import { ideaFields, ideaDraftSchema, type IdeaDraft, type IdeaDecision } from '../src/mastra/projects/idea-check';
type Origin = { title: string; draft: IdeaDraft; decision: IdeaDecision; approvedBy: string; approvedAt: string; version: number };
export function ProjectIdeaOrigin({ projectId }: { projectId: string }) {
  const [origin, setOrigin] = useState<Origin | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true; setOrigin(null); setError('');
    void requestJson<{ origin: Origin | null }>(`/api/projects/${encodeURIComponent(projectId)}/idea-origin`, 'Could not load the approved idea.')
      .then((data) => { if (active) setOrigin(data.origin); }).catch((caught) => { if (active) setError(caught.message); });
    return () => { active = false; };
  }, [projectId]);
  if (error) return <p role="alert">{error}</p>;
  if (!origin) return null;
  return <section className="project-meeting-panel"><h2>Approved idea — project starting point</h2>
    <p>Final pitch <span className="vs-mono">v{origin.version}</span> · confirmed by @{origin.approvedBy} · {formatDayTime(origin.approvedAt)}. Earlier drafts stay private.</p>
    <p>{origin.decision.rationale}</p><p>Next milestone: {origin.decision.nextMilestone}</p>
    <details><summary>Final approved pitch</summary><dl>{ideaFields.map((field) => <div key={field.key}><dt>{field.label}</dt><dd>{ideaDraftSchema.parse(origin.draft)[field.key]}</dd></div>)}</dl></details>
  </section>;
}
