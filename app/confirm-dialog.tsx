'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CircleHelp, TriangleAlert } from 'lucide-react';

/** One accessible confirmation dialog for the whole app (native <dialog>, focus return, Esc cancels). */
export function ConfirmDialog({
  id,
  open,
  title,
  message,
  confirmLabel,
  busy = false,
  onCancel,
  onConfirm,
  confirmPhrase,
  children,
  tone = 'danger',
  cancelLabel = 'Cancel',
}: {
  id: string;
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  /** Optional type-to-confirm guard (D7): the confirm button stays disabled until the exact value is typed. */
  confirmPhrase?: { value: string; label: string };
  /** Optional extra fields, such as a reason, shown above the buttons. */
  children?: ReactNode;
  /** 'danger' for destructive or irreversible actions; 'default' for ordinary confirmations. */
  tone?: 'danger' | 'default';
  cancelLabel?: string;
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const titleId = `${id}-title`;
  const messageId = `${id}-message`;
  const [typedPhrase, setTypedPhrase] = useState('');
  const phraseMatches = !confirmPhrase || typedPhrase.trim() === confirmPhrase.value.trim();
  useEffect(() => {
    if (open) setTypedPhrase('');
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      if (!dialog.open) dialog.showModal();
      window.requestAnimationFrame(() => cancelRef.current?.focus());
    } else if (dialog.open) {
      dialog.close();
      previousFocusRef.current?.focus();
    }
  }, [open]);

  useEffect(() => () => {
    if (dialogRef.current?.open) dialogRef.current.close();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className={`confirm-dialog${tone === 'default' ? ' is-default' : ''}`}
      aria-labelledby={titleId}
      aria-describedby={messageId}
      onClick={(event) => {
        event.stopPropagation();
        if (!busy && event.target === event.currentTarget) onCancel();
      }}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <form method="dialog" className="confirm-dialog-card">
        <header>
          <span className="confirm-dialog-icon" aria-hidden="true">
            {tone === 'danger' ? <TriangleAlert /> : <CircleHelp />}
          </span>
          <h2 id={titleId}>{title}</h2>
        </header>
        <p id={messageId}>{message}</p>
        {confirmPhrase && (
          <label className="confirm-dialog-phrase">
            <span>{confirmPhrase.label}</span>
            <input value={typedPhrase} autoComplete="off" spellCheck={false} onChange={(event) => setTypedPhrase(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') event.preventDefault(); }} />
          </label>
        )}
        {children}
        <footer>
          <button ref={cancelRef} className="ops-secondary" type="button" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button className={`ops-primary${tone === 'danger' ? ' danger-confirm' : ''}`} type="button" onClick={onConfirm} disabled={busy || !phraseMatches}>
            {busy ? 'Working' : confirmLabel}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
