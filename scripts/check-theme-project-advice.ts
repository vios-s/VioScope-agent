import assert from 'node:assert/strict';
import { suggestThemeMeetingSlot } from '../src/mastra/theme-meetings/project-advice';

const now = new Date('2026-10-27T12:00:00Z');
type Input = Parameters<typeof suggestThemeMeetingSlot>[0];
const project: Input = {
  lifecycle: 'active', status: 'on_track', blocker: null,
  stage: 3, stageProgress: 40, lastUpdate: '2026-10-27',
  submissionDeadline: null, updates: [],
};
const progress: Input['updates'][number] = {
  id: 'progress', date: '2026-10-27', byUsername: 'synthetic-member',
  type: 'progress', text: 'Finished an experiment.', milestone: true,
  stage: null, stageProgress: null, status: null, blocker: null, target: null,
  artifactIds: [], comments: [], createdAt: '2026-10-27T08:00:00Z',
};
const cases: Array<[string, Partial<Input>, string | null | undefined]> = [
  ['normal fresh progress', {}, 'short_update'],
  ['blocker takes priority', { blocker: 'Experiment is failing', stageProgress: 90 }, 'deep_dive'],
  ['blocked status', { status: 'blocked' }, 'deep_dive'],
  ['explicit request for input', { status: 'needs_input', stageProgress: 90 }, 'strategic_slot'],
  ['idea stage', { stage: 1 }, 'strategic_slot'],
  ['recent milestone', { updates: [progress] }, 'milestone_check'],
  ['stage nearly complete', { stageProgress: 80 }, 'milestone_check'],
  ['deadline in 30 days', { submissionDeadline: '2026-11-26' }, 'milestone_check'],
  ['deadline beyond 30 days', { submissionDeadline: '2026-11-27' }, 'short_update'],
  ['past deadline', { submissionDeadline: '2026-10-26' }, 'short_update'],
  ['missing progress', { lastUpdate: null }, null],
  ['14-day freshness boundary', { lastUpdate: '2026-10-13' }, null],
  ['old milestone is not promoted', { lastUpdate: '2026-10-01', updates: [{ ...progress, date: '2026-10-01' }] }, null],
  ['invalid progress date', { lastUpdate: 'invalid' }, null],
  ['future progress date', { lastUpdate: '2026-11-01' }, null],
  ['stale blocker stays visible', { lastUpdate: null, blocker: 'Recorded dependency' }, 'deep_dive'],
  ['near deadline stays visible without progress', { lastUpdate: null, submissionDeadline: '2026-10-28' }, 'milestone_check'],
  ['archived project', { lifecycle: 'archived' }, undefined],
  ['paused project', { lifecycle: 'paused' }, undefined],
];
for (const [name, changes, expected] of cases) {
  const input = { ...project, ...changes };
  const before = structuredClone(input);
  const advice = suggestThemeMeetingSlot(input, now);
  assert.equal(advice?.slot, expected, name);
  assert.notEqual(advice?.slot, 'nothing_to_report', name);
  assert.deepEqual(input, before, `${name}: advice must not mutate project state`);
  if (advice) assert.ok(advice.evidence && advice.preparation, `${name}: evidence and preparation required`);
}
assert.match(suggestThemeMeetingSlot({ ...project, blocker: 'Dataset unavailable' }, now)!.evidence, /Dataset unavailable/);
assert.match(suggestThemeMeetingSlot({ ...project, lastUpdate: null }, now)!.preparation, /Missing data does not mean nothing to report/);
console.log(JSON.stringify({ casesPassed: cases.length, evidence: 'required', missingProgressIsNotNothingToReport: true, writes: 0, emails: 0 }));
