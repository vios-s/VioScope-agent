'use client';

import { useId, useState } from 'react';

export function collaboratorTokens(value: string) {
  return value.split(',').map(item => item.trim()).filter(Boolean);
}

export function CollaboratorInput({ value, onChange, users, className = '', label = 'Collaborators', required = false, description, placeholder = 'alice, external collaborator' }: {
  value: string;
  onChange: (value: string) => void;
  users: { username: string; displayName?: string }[];
  className?: string;
  label?: string;
  required?: boolean;
  description?: string;
  placeholder?: string;
}) {
  const id = useId();
  const [focused, setFocused] = useState(false);
  const token = (value.split(',').at(-1) || '').trim().replace(/^@/, '').toLowerCase();
  const existing = new Set(collaboratorTokens(value).map(item => item.replace(/^@/, '').toLowerCase()));
  const suggestions = users.filter(user => !existing.has(user.username.toLowerCase()))
    .filter(user => !token || user.username.toLowerCase().includes(token) || user.displayName?.toLowerCase().includes(token)).slice(0, 5);

  function select(username: string) {
    const parts = value.split(',');
    parts[parts.length - 1] = username;
    onChange(`${collaboratorTokens(parts.join(',')).join(', ')}, `);
  }

  return <div className={['collaborator-field', className].filter(Boolean).join(' ')}
    onFocus={() => setFocused(true)}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}
    onKeyDown={event => { if (event.key === 'Escape' && focused) { event.stopPropagation(); setFocused(false); } }}>
    <label htmlFor={id}><span>{label}{required && <span className="field-required" aria-hidden="true"> *</span>}</span></label>
    <input id={id} value={value} required={required} aria-describedby={description} autoComplete="off"
      onChange={event => { onChange(event.target.value); setFocused(true); }} placeholder={placeholder} />
    {focused && suggestions.length > 0 && <div className="collaborator-suggestions" role="group" aria-label={`${label} suggestions`}>
      {suggestions.map(user => <button key={user.username} type="button"
        onMouseDown={event => event.preventDefault()} onClick={() => select(user.username)}>
        <strong>{user.displayName || user.username}</strong><span>@{user.username}</span>
      </button>)}
    </div>}
  </div>;
}
