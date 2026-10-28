import { useEffect, useState } from 'react';
import { requestJson } from './client-request';

export function IdeaPitchSharing({ pitchId, owner, collaborators, disabled, onBusyChanged, onChanged }: { pitchId: string; owner: string; collaborators: string[]; disabled: boolean; onBusyChanged: (busy: boolean) => void; onChanged: () => Promise<void> }) {
  const [users, setUsers] = useState<Array<{ username: string; displayName: string; role: string }>>([]);
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  useEffect(() => {
    let active = true;
    void requestJson<{ users: typeof users }>('/api/users/directory', 'Could not load accounts.').then(result => { if (active) setUsers(result.users); }).catch(caught => { if (active) setError(caught.message); });
    return () => { active = false; };
  }, []);
  async function change(target: string, action: 'add' | 'remove') {
    setBusy(true); onBusyChanged(true); setError(''); setStatus('');
    try {
      await requestJson(`/api/idea-pitches/${pitchId}/collaborators`, 'Could not change sharing.', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: target, action }) });
      await onChanged(); setUsername(''); setStatus(action === 'add' ? `Shared with @${target}.` : `Access removed for @${target}.`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not change sharing.'); }
    finally { setBusy(false); onBusyChanged(false); }
  }
  return <section className="idea-sharing"><h4>Share with collaborators</h4>
    <p>People you add can read the latest saved pitch and decision. Source documents, AI reviews and older versions stay private. They cannot edit, approve, delete, export or share it onward.</p>
    {error && <p role="alert">{error}</p>}{status && <p role="status">{status}</p>}
    <div className="idea-export-controls"><label>Add people<select aria-label="Add people" value={username} disabled={busy || disabled} onChange={event => setUsername(event.target.value)}>
      <option value="">Choose an active account</option>
      {users.filter(user => user.username !== owner && user.role !== 'pi' && user.role !== 'administrator' && !collaborators.includes(user.username)).map(user => <option key={user.username} value={user.username}>@{user.username} · {user.displayName}</option>)}
    </select></label><button type="button" className="ops-secondary" disabled={busy || disabled || !username} onClick={() => void change(username, 'add')}>Add collaborator</button></div>
    {collaborators.length ? <ul>{collaborators.map(name => <li key={name}><span>@{name} · Read only</span><button type="button" className="ops-secondary" aria-label={`Remove collaborator ${name}`} disabled={busy || disabled} onClick={() => void change(name, 'remove')}>Remove</button></li>)}</ul> : <p>The proposer, PI and administrator have access.</p>}
    <p>Sharing a pitch does not grant access to its future project. No notification is sent.</p>
  </section>;
}
