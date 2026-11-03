'use client';

import { useEffect, useState } from 'react';

function displayDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '';
}

export function UkDateInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [text, setText] = useState(displayDate(value));
  useEffect(() => { setText(displayDate(value)); }, [value]);

  return <input type="text" inputMode="numeric" placeholder="DD/MM/YYYY" value={text}
    onChange={event => {
      const input = event.currentTarget;
      const next = input.value;
      setText(next);
      const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(next);
      const iso = match ? `${match[3]}-${match[2]}-${match[1]}` : '';
      const date = new Date(`${iso}T00:00:00Z`);
      const valid = Boolean(match && !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === iso);
      input.setCustomValidity(next && !valid ? 'Enter a valid date as DD/MM/YYYY.' : '');
      if (valid || !next) onChange(iso);
    }} />;
}
