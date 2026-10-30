// Dates and times always read in UK time, whatever the browser or server time zone.
process.env.TZ = 'America/New_York';
import assert from 'node:assert/strict';
const { formatDay, formatDayTime, formatTime } = await import('../app/format');
assert.equal(new Date('2026-11-04T10:00').getHours(), 10, 'Precondition: the runtime parses offsetless times as New York local time.');
assert.equal(formatDayTime('2026-11-04T10:00'), '4 Nov 2026, 10:00', 'Offsetless winter slot is UK wall-clock time.');
assert.equal(formatTime('2026-07-01T11:00:00'), '11:00', 'Offsetless summer slot is UK wall-clock time.');
assert.equal(formatDayTime('2026-07-01T09:00:00Z'), '1 Jul 2026, 10:00', 'UTC instants show in British Summer Time.');
assert.equal(formatDayTime('2026-10-29 23:44:09.266+00'), '29 Oct 2026, 23:44', 'PostgreSQL text timestamps parse.');
assert.equal(formatDay('2026-11-04'), '4 Nov 2026', 'Calendar days never shift.');
assert.equal(formatDay('not a date'), 'not a date');
console.log('Format passed: UK wall-clock reading of offsetless times under a non-UK runtime zone, BST/GMT instants, PostgreSQL timestamps and calendar days.');
