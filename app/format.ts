// One date/time style for the whole app, always in UK time (Europe/London).
// Day: "4 Nov 2026"; day and time: "4 Nov 2026, 10:00"; short day: "4 Nov"; weekday headers: "Wednesday 4 November 2026".

const zone = 'Europe/London';

function parse(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  // Plain dates are calendar days; read them at noon UTC so they never shift a day.
  const text = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value}T12:00:00Z`
    // PostgreSQL text timestamps use "YYYY-MM-DD HH:MM:SS+00".
    : value.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00');
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function format(value: string | Date | null | undefined, options: Intl.DateTimeFormatOptions, fallback: string) {
  const date = parse(value);
  if (!date) return typeof value === 'string' && value ? value : fallback;
  // en-GB abbreviates September as "Sept"; use the three-letter form like every other month.
  return new Intl.DateTimeFormat('en-GB', { timeZone: zone, ...options }).format(date).replace(/\bSept\b/, 'Sep');
}

export function formatDay(value: string | Date | null | undefined, fallback = '—') {
  return format(value, { day: 'numeric', month: 'short', year: 'numeric' }, fallback);
}

export function formatDayTime(value: string | Date | null | undefined, fallback = '—') {
  return format(value, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }, fallback);
}

export function formatShortDay(value: string | Date | null | undefined, fallback = '—') {
  return format(value, { day: 'numeric', month: 'short' }, fallback);
}

export function formatLongDay(value: string | Date | null | undefined, fallback = '—') {
  return format(value, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }, fallback).replace(',', '');
}

export function formatTime(value: string | Date | null | undefined, fallback = '—') {
  return format(value, { hour: '2-digit', minute: '2-digit', hour12: false }, fallback);
}
