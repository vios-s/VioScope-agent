'use client';
import type { RefObject } from 'react';
import { Archive, RotateCcw } from 'lucide-react';

/** The project record's ⋯ menu: one item, Archive (type-the-title dialog follows) or Unarchive. */
export function ProjectRecordMenu({ menuRef, trigger, title, archived, onClose, onSelect }: {
  menuRef: RefObject<HTMLDivElement | null>;
  trigger: HTMLElement | null;
  title: string;
  archived: boolean;
  onClose: () => void;
  onSelect: () => void;
}) {
  return (
    <div
      ref={menuRef}
      className="row-menu vs-record-menu"
      role="menu"
      aria-label={`Actions for ${title}`}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' && !(event.key === 'Tab' && event.shiftKey)) return;
        // Escape closes only this menu, not the record dialog around it.
        event.preventDefault();
        event.stopPropagation();
        onClose();
        trigger?.focus();
      }}
      onBlur={(event) => {
        const next = event.relatedTarget as Node | null;
        if (next && next !== trigger && !event.currentTarget.contains(next)) onClose();
      }}
    >
      <button className={archived ? '' : 'danger'} type="button" role="menuitem" tabIndex={-1} onClick={() => { onClose(); onSelect(); }}>
        {archived ? <RotateCcw aria-hidden="true" /> : <Archive aria-hidden="true" />}
        {archived ? 'Unarchive' : 'Archive project'}
      </button>
    </div>
  );
}
