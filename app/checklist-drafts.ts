'use client';

import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from 'react';

export function checklistDraftKey(userId: string, name: string) {
  return `vios-checklist:v1:${userId}:${name}`;
}

export function readChecklistDraft<T>(key: string, fallback: T): T {
  try {
    const value = sessionStorage.getItem(key);
    return value === null ? fallback : JSON.parse(value) as T;
  } catch { return fallback; }
}

export function writeChecklistDraft(key: string, value: unknown) {
  try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* Browser storage may be unavailable. */ }
}

export function removeChecklistDraft(key: string) {
  try { sessionStorage.removeItem(key); } catch { /* Browser storage may be unavailable. */ }
}

export function clearChecklistDrafts(userId: string) {
  try {
    const prefix = checklistDraftKey(userId, '');
    Object.keys(sessionStorage).filter(key => key.startsWith(prefix)).forEach(removeChecklistDraft);
  } catch { /* Browser storage may be unavailable. */ }
}

export function useChecklistDraft<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => readChecklistDraft(key, initial));
  const current = useRef(value);
  const update = useCallback<Dispatch<SetStateAction<T>>>((next) => {
    const resolved = typeof next === 'function' ? (next as (previous: T) => T)(current.current) : next;
    current.current = resolved;
    writeChecklistDraft(key, resolved);
    setValue(resolved);
  }, [key]);
  return [value, update];
}
