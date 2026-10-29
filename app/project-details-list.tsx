'use client';
import type { ReactNode } from 'react';
import { Pencil } from 'lucide-react';
import { formatDay } from './format';

type ManagedProject = {
  project: string; stage: number; stageProgress: number; track: string; ownerUsername: string;
  piUsername?: string | null; pdraUsername?: string | null; collaborators: string[]; venue: string | null;
  submissionDeadline: string | null; notes: string | null; watchPath: string | null;
};

const person = (username: string | null | undefined) => (username ? `@${username}` : 'Not assigned');

/** Read-only project details; editing opens the shared Add/Edit project form. */
export function ProjectDetailsList({ project, status, lifecycle, admin, onEdit }: {
  project: ManagedProject;
  status: ReactNode;
  lifecycle: string;
  admin: boolean;
  onEdit?: () => void;
}) {
  const rows: Array<[string, ReactNode]> = [
    ['Status', status],
    ['Stage', `Stage ${project.stage} of 5 · ${project.stageProgress}% progress`],
    ['Lifecycle', lifecycle],
    ['Track', `Track ${project.track}`],
    ['Owner', person(project.ownerUsername)],
    ['PI', person(project.piUsername)],
    ['PDRA reviewer', person(project.pdraUsername)],
    ['Collaborators', project.collaborators.join(', ') || 'None'],
    ['Venue', project.venue || 'Not set'],
    ['Submission deadline', formatDay(project.submissionDeadline, 'Not set')],
    ['Notes', project.notes || 'None'],
  ];
  return (
    <section className="vs-details-section" aria-labelledby="project-details-heading">
      <div className="vs-section-head">
        <h2 id="project-details-heading">Project details</h2>
        {onEdit && (
          <button className="ops-secondary" type="button" onClick={onEdit}>
            <Pencil aria-hidden="true" />
            Edit details
          </button>
        )}
      </div>
      <dl className="vs-details-list">
        {rows.map(([term, value]) => (
          <div key={term}>
            <dt>{term}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {admin && (
        <details className="vs-advanced">
          <summary>Advanced</summary>
          <dl className="vs-details-list">
            <div><dt>Slug</dt><dd className="vs-mono">{project.project}</dd></div>
            <div><dt>Watch path</dt><dd className="vs-mono">{project.watchPath || 'Not set'}</dd></div>
          </dl>
        </details>
      )}
    </section>
  );
}
