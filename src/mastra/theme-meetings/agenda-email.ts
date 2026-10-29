import { formatMeetingProject } from './project-context';
import { themeUpdateTypeLabels as slotLabels, type ThemeMeetingAgendaItem, type ThemeMeetingPlan } from './schema';

/** The human-confirmed version being circulated; `skipped` lists items the manager left out of this meeting. */
export type ConfirmedAgendaEmail = { version: number; confirmedBy: string; confirmedAt: string; skipped: ThemeMeetingAgendaItem[] };

const advisory = 'This agenda is advisory until confirmed by a coordinator, PI, or administrator.';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!);
}

function multiline(value: string): string {
  return escapeHtml(value).replace(/\r\n|\r|\n/g, '<br>');
}

function updateBlocks(value: string): { bullet: boolean; text: string }[] {
  const blocks: { bullet: boolean; text: string }[] = [];
  // Only split inline enumeration when it starts at a/1 and continues in sequence.
  // This avoids treating ordinary numbers, dates, or hyphens in prose as lists.
  const lines = value.replace(/\r\n|\r/g, '\n').split('\n').flatMap((line) => {
    const markers = [...line.matchAll(/(?:^|[ \t]+)([a-z]\)|\d{1,2}[.)])[ \t]+/gi)];
    const first = markers[0]?.[1]?.toLowerCase();
    if (markers.length < 2 || (first !== 'a)' && first !== '1.' && first !== '1)')) return [line];
    const alphabetic = first === 'a)';
    if (!markers.every((marker, index) => alphabetic
      ? marker[1]!.toLowerCase() === `${String.fromCharCode(97 + index)})`
      : Number.parseInt(marker[1]!, 10) === index + 1)) return [line];
    const prefix = line.slice(0, markers[0]!.index).trim();
    return [
      ...(prefix ? [prefix] : []),
      ...markers.map((marker, index) => `• ${line.slice(marker.index! + marker[0].length, markers[index + 1]?.index).trim()}`),
    ];
  });
  let separate = true;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      separate = true;
      continue;
    }
    const marker = trimmed.match(/^(?:[-*•](?:\s+|(?=\p{L}))|(?:\d{1,2}[.)]|[a-z]\))\s+)/iu);
    if (marker) {
      blocks.push({ bullet: true, text: trimmed.slice(marker[0].length) });
    } else if (!separate && blocks.length) {
      blocks[blocks.length - 1]!.text += `\n${trimmed}`;
    } else {
      blocks.push({ bullet: false, text: trimmed });
    }
    separate = false;
  }
  return blocks;
}

function updateText(value: string): string {
  return updateBlocks(value).map((block) => `${block.bullet ? '• ' : ''}${block.text}`).join('\n');
}

function updateHtml(value: string): string {
  let html = '';
  let inList = false;
  for (const block of updateBlocks(value)) {
    if (block.bullet && !inList) html += '<ul style="margin:0 0 12px;padding-left:22px;">';
    if (!block.bullet && inList) html += '</ul>';
    html += block.bullet
      ? `<li style="margin:0 0 6px;">${multiline(block.text)}</li>`
      : `<p style="margin:0 0 12px;">${multiline(block.text)}</p>`;
    inList = block.bullet;
  }
  return html + (inList ? '</ul>' : '');
}

function discussionItems(meeting: ThemeMeetingPlan['meetings'][number], confirmed = false) {
  const items = meeting.agenda_items.filter((item) => item.duration_minutes > 0);
  // A confirmed agenda keeps the order the coordinator chose.
  return confirmed ? items : items.sort((a, b) =>
    Number(b.update_type === 'deep_dive') - Number(a.update_type === 'deep_dive')
    || b.duration_minutes - a.duration_minutes);
}

function skipSuggestion(meeting: ThemeMeetingPlan['meetings'][number]): string {
  return `Suggestion: consider skipping this meeting, as no discussion slots were requested.${meeting.missing_members.length ? ' Some updates are missing; check with those members first.' : ''} Coordinator, PI, or administrator confirmation is required; the meeting remains scheduled.`;
}

export function renderThemeMeetingAgendaEmail(
  plan: ThemeMeetingPlan,
  options: { phase?: 'preview' | 'final'; cutoff?: { weekday: string; time: string }; confirmation?: ConfirmedAgendaEmail } = {},
): { text: string; html: string } {
  const preview = options.phase === 'preview';
  const confirmed = options.confirmation;
  const title = preview ? 'Draft theme meeting agenda' : confirmed ? 'Confirmed theme meeting agenda' : 'Theme meeting agenda';
  const missingLabel = preview ? 'Not submitted yet' : 'Missing updates';
  const confirmedAt = confirmed && new Date(confirmed.confirmedAt).toLocaleString('en-GB', { timeZone: 'Europe/London', dateStyle: 'medium', timeStyle: 'short' });
  const notice = preview
    ? `This is a draft based on updates submitted so far (${plan.generated_at}). Review who is doing a deep dive and adjust your own slot, update or presentation plans before ${options.cutoff?.weekday || 'Wednesday'} ${options.cutoff?.time || '08:00'} (${plan.timezone}). More submissions and changes may follow. The cutoff agenda will be circulated after the deadline.`
    : confirmed
      ? `Final agenda, version ${confirmed.version}, confirmed by @${confirmed.confirmedBy} on ${confirmedAt} (UK time). Items are listed in the confirmed order; later submissions do not change this version.`
      : advisory;
  const emptyDiscussion = preview ? 'No discussion slots requested yet.' : 'No discussion slots requested.';
  const noSlotsNotice = (meeting: ThemeMeetingPlan['meetings'][number]) => preview
    ? 'Submissions are still open. This draft does not decide whether the meeting should be skipped.'
    : confirmed ? 'The confirmed agenda has no discussion slots.' : skipSuggestion(meeting);
  // Planned start times follow the confirmed order and slot lengths.
  const starts = (meeting: ThemeMeetingPlan['meetings'][number]) => {
    const [hours, minutes] = meeting.time.split(':').map(Number);
    let clock = (hours || 0) * 60 + (minutes || 0);
    return new Map(meeting.agenda_items.map((item) => {
      const start = `${String(Math.floor(clock / 60) % 24).padStart(2, '0')}:${String(clock % 60).padStart(2, '0')}`;
      clock += item.duration_minutes;
      return [item, start] as const;
    }));
  };
  const skippedText = confirmed?.skipped.length
    ? ['Skipped at this meeting', confirmed.skipped.map((item) => `${item.member} | ${slotLabels[item.update_type]} | not scheduled`).join('\n')]
    : [];
  const skippedHtml = confirmed?.skipped.length ? `
    <tr><td style="padding:16px 24px;">
      <h3 style="margin:0 0 8px;font-size:18px;color:#183b4e;">Skipped at this meeting</h3>
      <ul style="margin:0;padding-left:22px;color:#52616b;">${confirmed.skipped.map((item) => `<li style="margin:0 0 6px;">${escapeHtml(item.member)} &middot; ${slotLabels[item.update_type]} &middot; not scheduled</li>`).join('')}</ul>
    </td></tr>` : '';
  const meetings = plan.meetings.filter((meeting) => !meeting.cancelled);
  const text = [
    title,
    `Date: ${plan.meeting_date} | Cycle group: ${plan.cycle_group} | Timezone: ${plan.timezone}`,
    notice,
    ...meetings.map((meeting) => {
      const discussion = discussionItems(meeting, Boolean(confirmed));
      const written = meeting.agenda_items.filter((item) => item.duration_minutes === 0);
      const start = starts(meeting);
      return [
      `Theme ${meeting.theme_id} — ${meeting.title}`,
      `${meeting.time} | ${meeting.duration_minutes} min | Coordinator: ${meeting.coordinator}`,
      `Submitted: ${meeting.submitted_members.length}/${meeting.members.length} | Planned: ${meeting.planned_minutes}/${meeting.duration_minutes} min${meeting.overbooked ? ' (overbooked)' : ''}`,
      `${missingLabel}: ${meeting.missing_members.join(', ') || 'None'}`,
      'Discussion agenda',
      discussion.map((item) => `${confirmed ? `${start.get(item)} | ` : ''}${item.member} | ${slotLabels[item.update_type]} | ${item.duration_minutes} min`).join('\n') || emptyDiscussion,
      ...(discussion.length ? [] : [noSlotsNotice(meeting)]),
      ...[...discussion, ...written].map((item, index) => [
        ...(index === 0 ? [discussion.length ? 'Discussion details' : 'Updates'] : index === discussion.length ? ['Updates'] : []),
        `${item.member} — ${slotLabels[item.update_type]} (${item.duration_minutes} min)`,
        updateText(item.progress_text),
        ...(item.project_context ? [formatMeetingProject(item.project_context)] : []),
        ...(item.questions ? [`Questions: ${updateText(item.questions)}`] : []),
      ].join('\n')),
      ...(meeting.agenda_items.length ? [] : ['No planned updates yet.']),
      ...skippedText,
    ].join('\n\n');
    }),
    ...(meetings.length ? [] : ['No active theme meetings are scheduled.']),
  ].join('\n\n');

  // Outlook-compatible layout: table structure and inline styles, without a CSS dependency.
  const sections = meetings.map((meeting) => {
    const discussion = discussionItems(meeting, Boolean(confirmed));
    const written = meeting.agenda_items.filter((item) => item.duration_minutes === 0);
    const start = starts(meeting);
    const details = (items: typeof meeting.agenda_items, title: string) => items.length ? `
    <tr><td style="padding:20px 24px 8px;"><h3 style="margin:0;font-size:18px;color:#183b4e;">${title}</h3></td></tr>
    ${items.map((item) => `
    <tr><td style="padding:16px 24px;border-bottom:1px solid #edf0f3;">
      <h4 style="margin:0 0 4px;font-size:16px;line-height:1.5;">${escapeHtml(item.member)}</h4>
      <p style="margin:0 0 10px;font-size:13px;color:#52616b;">${slotLabels[item.update_type]} &middot; ${item.duration_minutes} min</p>
      <div style="overflow-wrap:anywhere;word-break:break-word;">${updateHtml(item.progress_text)}</div>
      ${item.project_context ? `<div style="margin-top:12px;white-space:pre-wrap;overflow-wrap:anywhere;">${escapeHtml(formatMeetingProject(item.project_context))}</div>` : ''}
      ${item.questions ? `<div style="margin:12px 0 0;overflow-wrap:anywhere;word-break:break-word;"><strong>Questions</strong>${updateHtml(item.questions)}</div>` : ''}
    </td></tr>`).join('')}` : '';
    return `
    <tr><td style="padding:28px 24px 12px;border-top:1px solid #dce3e9;">
      <h2 style="margin:0 0 8px;font-size:21px;line-height:1.4;color:#183b4e;">Theme ${escapeHtml(meeting.theme_id)} &mdash; ${escapeHtml(meeting.title)}</h2>
      <p style="margin:0 0 12px;">${escapeHtml(meeting.time)} &middot; ${meeting.duration_minutes} min &middot; Coordinator: ${escapeHtml(meeting.coordinator)}</p>
      <p style="margin:0 0 6px;color:#52616b;">Submitted: <strong>${meeting.submitted_members.length}/${meeting.members.length}</strong> &nbsp; Planned: <strong>${meeting.planned_minutes}/${meeting.duration_minutes} min${meeting.overbooked ? ' (overbooked)' : ''}</strong></p>
      <p style="margin:0 0 8px;color:#52616b;">${missingLabel}: ${escapeHtml(meeting.missing_members.join(', ') || 'None')}</p>
    </td></tr>
    <tr><td style="padding:8px 24px 16px;">
      <h3 style="margin:0 0 10px;font-size:18px;color:#183b4e;">Discussion agenda</h3>
      ${discussion.length ? `<table aria-label="Theme ${escapeHtml(meeting.theme_id)} discussion agenda" width="100%" cellpadding="0" cellspacing="0" style="width:100%;table-layout:fixed;border-collapse:collapse;font-size:14px;line-height:1.5;">
        <thead><tr style="background-color:#edf3f6;">
          ${confirmed ? '<th scope="col" width="14%" align="left" style="padding:10px 8px;border-bottom:1px solid #dce3e9;">Start</th>' : ''}
          <th scope="col" width="${confirmed ? 36 : 44}%" align="left" style="padding:10px 8px;border-bottom:1px solid #dce3e9;">Member</th>
          <th scope="col" width="${confirmed ? 32 : 36}%" align="left" style="padding:10px 8px;border-bottom:1px solid #dce3e9;">Discussion</th>
          <th scope="col" width="${confirmed ? 18 : 20}%" align="right" style="padding:10px 8px;border-bottom:1px solid #dce3e9;">Minutes</th>
        </tr></thead><tbody>${discussion.map((item) => `<tr>
          ${confirmed ? `<td style="padding:12px 8px;border-bottom:1px solid #dce3e9;">${start.get(item)}</td>` : ''}
          <td style="padding:12px 8px;border-bottom:1px solid #dce3e9;overflow-wrap:anywhere;word-break:break-word;">${escapeHtml(item.member)}</td>
          <td style="padding:12px 8px;border-bottom:1px solid #dce3e9;overflow-wrap:anywhere;word-break:break-word;">${slotLabels[item.update_type]}</td>
          <td align="right" style="padding:12px 8px;border-bottom:1px solid #dce3e9;">${item.duration_minutes}</td>
        </tr>`).join('')}</tbody></table>` : `<p style="margin:0 0 12px;color:#52616b;">${emptyDiscussion}</p><p style="margin:0;padding:12px;background-color:#edf3f6;">${escapeHtml(noSlotsNotice(meeting))}</p>`}
    </td></tr>
    ${details(discussion, 'Discussion details')}
    ${details(written, 'Updates')}
    ${meeting.agenda_items.length ? '' : '<tr><td style="padding:16px 24px;">No planned updates yet.</td></tr>'}
    ${skippedHtml}
  `;
  }).join('');

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head>
<body style="margin:0;padding:0;background-color:#f3f5f7;color:#24333d;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.6;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f5f7;"><tr><td align="center" style="padding:24px 8px;">
<table role="presentation" width="680" cellpadding="0" cellspacing="0" style="width:100%;max-width:680px;background-color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.6;color:#24333d;">
  <tr><td style="padding:24px;background-color:#183b4e;color:#ffffff;">
    <p style="margin:0 0 8px;font-size:13px;letter-spacing:1px;">VIOSCOPE &middot; ${preview ? 'DRAFT AGENDA PREVIEW' : confirmed ? `CONFIRMED AGENDA &middot; VERSION ${confirmed.version}` : 'ADVISORY AGENDA'}</p>
    <h1 style="margin:0 0 12px;font-size:28px;line-height:1.3;">${title}</h1>
    <p style="margin:0;">${escapeHtml(plan.meeting_date)} &middot; Cycle ${escapeHtml(plan.cycle_group)}<br>${escapeHtml(plan.timezone)}</p>
  </td></tr>
  ${preview ? `<tr><td style="padding:16px 24px;background-color:#fff3cd;">${escapeHtml(notice)}</td></tr>` : confirmed ? `<tr><td style="padding:16px 24px;background-color:#e6f2ec;">${escapeHtml(notice)}</td></tr>` : ''}
  ${sections || '<tr><td style="padding:24px;">No active theme meetings are scheduled.</td></tr>'}
  <tr><td style="padding:20px 24px;background-color:#edf3f6;color:#52616b;font-size:13px;">${confirmed ? 'Confirmed by a theme coordinator, PI or administrator in VioScope. Project details are the snapshots members shared when they submitted.' : advisory}</td></tr>
</table>
</td></tr></table>
</body></html>`;
  return { text, html };
}
