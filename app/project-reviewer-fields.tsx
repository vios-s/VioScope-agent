'use client';

import { useEffect, useId, useState } from 'react';
import { CollaboratorInput, collaboratorTokens } from './collaborator-input';

type Team = { piUsernames: string[]; pdraUsernames: string[]; pdraUsername: string };
type User = { username: string; role: string; displayName?: string };
const usernames = (text: string) => [...new Set(collaboratorTokens(text).map(name => name.replace(/^@/, '').toLowerCase()))];

function ReviewerInput({ value, onChange, ...props }: Omit<Parameters<typeof CollaboratorInput>[0], 'value' | 'onChange'> & { value: string[]; onChange: (value: string[]) => void }) {
  const [text, setText] = useState(value.join(', '));
  const saved = value.join(', ');
  useEffect(() => {
    setText(current => usernames(current).join(', ') === saved ? current : saved);
  }, [saved]);
  return <CollaboratorInput {...props} value={text} onChange={next => { setText(next); onChange(usernames(next)); }} />;
}

export function ProjectReviewTeamFields({ team, owner, users, onChange, required = false }: {
  team: Team; owner: string; users: User[]; onChange: (team: Team) => void; required?: boolean;
}) {
  const hint = useId();
  return <>
    <ReviewerInput label="Project PIs" required={required} placeholder="Search PI accounts"
      users={users.filter(user => ['pi', 'administrator'].includes(user.role))} value={team.piUsernames}
      onChange={piUsernames => onChange({ ...team, piUsernames })} />
    <ReviewerInput label="Project PDRAs" required={required} placeholder="Search reviewer accounts"
      users={users.filter(user => user.username !== owner)} value={team.pdraUsernames}
      onChange={pdraUsernames => onChange({ ...team, pdraUsernames, pdraUsername: pdraUsernames.includes(team.pdraUsername) ? team.pdraUsername : pdraUsernames[0] || '' })} />
    <div className="project-reviewer-field"><label htmlFor={hint + '-lead'}><span>Lead PDRA reviewer{required && <span className="field-required" aria-hidden="true"> *</span>}</span></label>
      <select id={hint + '-lead'} required={required} value={team.pdraUsername} onChange={event => onChange({ ...team, pdraUsername: event.target.value })}>
        <option value="" disabled={team.pdraUsernames.length > 0}>Not assigned</option>
        {team.pdraUsernames.map(username => <option key={username} value={username}>@{username}</option>)}
      </select>
    </div>
  </>;
}
