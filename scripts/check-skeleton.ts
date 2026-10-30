import 'dotenv/config';
import assert from 'node:assert/strict';
import { skeletonDraftSchema, renderSkeletonDraft, skeletonFields, measurePaperSkeleton, paperSkeletonRequirements } from '../src/mastra/submission/skeleton';
import { skeletonDecisionSchema, skeletonOutcomeLabels, skeletonVerdictLabels, londonToday, latestSkeletonDecisions } from '../src/mastra/submission/skeleton-record';
import { submissionReviewModelOutputSchema, submissionReviewStructuredSchema } from '../src/mastra/submission/schema';
import { normalizePaperSkeleton } from '../src/mastra/submission/review';
const draft = skeletonDraftSchema.parse({ claim: 'A synthetic claim; no results yet.' });
assert.throws(() => renderSkeletonDraft(skeletonDraftSchema.parse({})), /Add evidence/);
const text = renderSkeletonDraft(draft);
assert.ok(text.includes(draft.claim));
assert.equal(text.split('[Not provided]').length - 1, 7);
for (const field of skeletonFields) assert.ok(text.includes(field.label));
assert.equal(skeletonDraftSchema.safeParse({ claim: 'x'.repeat(6001) }).success, false);

// PDRA verdicts: new writes accept only the VIOS OS verdicts; CONDITIONAL needs a future Europe/London date.
const day = (offset: number) => new Date(Date.parse(`${londonToday()}T00:00:00Z`) + offset * 86400000).toISOString().slice(0, 10);
const pdra = (outcome: string, reevaluateOn?: string) => skeletonDecisionSchema.safeParse({ kind: 'pdra', outcome, note: 'Synthetic note.', revision: 0, confirmed: true, ...(reevaluateOn ? { reevaluateOn } : {}) });
for (const legacy of ['locked', 'conditional', 'revise']) assert.equal(pdra(legacy).success, false, `Legacy ${legacy} is read-only.`);
assert.equal(pdra('CLEARED').success, true);
assert.equal(pdra('SLIDE').success, true);
assert.equal(pdra('CONDITIONAL').success, false, 'CONDITIONAL requires a re-evaluation date.');
assert.equal(pdra('CONDITIONAL', day(0)).success, false, 'Today is not a future date.');
assert.equal(pdra('CONDITIONAL', day(-1)).success, false);
assert.equal(pdra('CONDITIONAL', '2030-02-30').success, false, 'Impossible calendar dates are rejected.');
assert.equal(pdra('CONDITIONAL', day(3)).success, true);
assert.equal(pdra('CLEARED', day(3)).success, false, 'A re-evaluation date applies only to CONDITIONAL.');
assert.equal(londonToday(new Date('2026-07-01T23:30:00Z')), '2026-07-02', 'London summer time decides the calendar day.');
assert.equal(londonToday(new Date('2026-12-01T23:30:00Z')), '2026-12-01');
// Legacy records still render with their original labels; AI and PDRA share one vocabulary.
assert.equal(skeletonOutcomeLabels.locked, 'Ready to lock');
assert.equal(skeletonOutcomeLabels.revise, 'Revise before locking');
assert.equal(skeletonOutcomeLabels.conditional, 'Conditional — actions required');
for (const verdict of ['CLEARED', 'CONDITIONAL', 'SLIDE']) assert.equal(skeletonOutcomeLabels[verdict], skeletonVerdictLabels[verdict]);
assert.equal(latestSkeletonDecisions([{ kind: 'pdra', outcome: 'revise', note: 'n', by: 'a', at: 'x' }]).pdra?.outcome, 'revise');
// Re-recording the same verdict keeps the PI confirmation; a changed verdict or CONDITIONAL date needs a fresh one.
const decided = (outcome: string, reevaluateOn?: string) => ({ kind: 'pdra' as const, outcome, note: 'n', by: 'p', at: 'x', ...(reevaluateOn ? { reevaluateOn } : {}) });
const piOk = { kind: 'pi' as const, outcome: 'approved', note: 'n', by: 'q', at: 'x' };
assert.equal(latestSkeletonDecisions([decided('CLEARED'), piOk, decided('CLEARED')]).pi?.outcome, 'approved');
assert.equal(latestSkeletonDecisions([decided('CLEARED'), piOk, decided('SLIDE')]).pi, null);
assert.equal(latestSkeletonDecisions([decided('CLEARED'), piOk, decided('SLIDE'), decided('CLEARED')]).pi, null, 'An intervening changed verdict voids the earlier confirmation.');
assert.equal(latestSkeletonDecisions([decided('CONDITIONAL', '2030-01-02'), piOk, decided('CONDITIONAL', '2030-01-02')]).pi?.outcome, 'approved');
assert.equal(latestSkeletonDecisions([decided('CONDITIONAL', '2030-01-02'), piOk, decided('CONDITIONAL', '2030-01-09')]).pi, null);

// Paper Skeleton: measured counts from the supplied text.
const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');
assert.match(measurePaperSkeleton(`\\begin{abstract}\n${words(231)} \\textbf{x}\n\\end{abstract}`).abstract!, /^232 words/);
assert.match(measurePaperSkeleton(`# Title\n\n## Abstract\n${words(120)}\n\n${words(30)}\n## 1 Introduction\n${words(400)}`).abstract!, /^150 words/);
assert.match(measurePaperSkeleton(`Abstract\n${words(210)}\n1. Introduction\nMore text.`).abstract!, /^210 words/);
assert.equal(measurePaperSkeleton(renderSkeletonDraft(skeletonDraftSchema.parse({ outline: 'Abstract: state the question.' }))).abstract, undefined, 'An outline line is not an abstract section.');
const bib = Array.from({ length: 21 }, (_, i) => `@inproceedings{key${i},\n  title={T${i}}\n}`).join('\n') + '\n@string{venue = "X"}\n@article{key0,\n}';
assert.equal(measurePaperSkeleton(bib).references, '21 BibTeX entries');
assert.equal(measurePaperSkeleton('Text \\cite{a,b} and \\citep[p.~2]{c} \\cite{a}').references, '3 distinct \\cite keys');
assert.equal(measurePaperSkeleton('## References\n[1] A. Author. Paper.\n[2] B. Author. Paper.\n3. C. Author.').references, '3 numbered references');
assert.deepEqual(measurePaperSkeleton('No paper sections here.'), {});
// Long whitespace runs must not trigger catastrophic regex backtracking.
for (const hostile of ['References' + ' '.repeat(59000) + 'x', 'Abstract' + ' '.repeat(59000) + 'x', 'Abstract\n' + ' '.repeat(59000) + 'x', '\n'.repeat(59000) + 'x', '@' + ' '.repeat(59000) + 'x', '1.' + ' '.repeat(59000)]) {
  const started = performance.now(); measurePaperSkeleton(hostile);
  assert.ok(performance.now() - started < 100, `Measurement must finish within 100 ms (${JSON.stringify(hostile.slice(0, 12))}…).`);
}

// Paper Skeleton: model output parsing, template order, quote check and backward compatibility.
const source = `## Abstract\n${words(220)}\n## Introduction\nWe pitch this as an efficiency paper.`;
const parsed = submissionReviewModelOutputSchema.parse({ verdict: 'CONDITIONAL', summary: 's', findings: [], reasonsToReject: [], checkmateQuestions: [], mitigations: [], humanSignOff: { leadPdra: 'pending', piOrOrganizer: 'pending', remainingEvidenceNeeded: [] }, perSkillNotes: [],
  paperSkeleton: [{ id: 'introduction', status: 'partly', evidence: 'We pitch this as an  EFFICIENCY paper.' }, { id: 'title', status: 'met', evidence: 'An invented quotation' }, { id: 'unknown-id', status: 'met', evidence: 'x' }] });
const items = normalizePaperSkeleton(parsed.paperSkeleton, source);
assert.deepEqual(items.map(item => item.id), paperSkeletonRequirements.map(item => item.id));
assert.equal(items.find(item => item.id === 'introduction')!.quoteFound, true);
assert.equal(items.find(item => item.id === 'title')!.quoteFound, false, 'Quotes absent from the source are flagged.');
assert.deepEqual(items.find(item => item.id === 'notation'), { id: 'notation', status: 'unknown', evidence: 'not found', quoteFound: false });
assert.match(items.find(item => item.id === 'abstract')!.measured!, /^220 words/);
// Model status wording varies: obvious synonyms map, anything else becomes unknown instead of failing the check.
const statusOf = (status: string) => submissionReviewModelOutputSchema.parse({ ...parsed, paperSkeleton: [{ id: 'title', status, evidence: 'x' }] }).paperSkeleton![0].status;
assert.equal(statusOf('partial'), 'partly'); assert.equal(statusOf('Partly met'), 'partly'); assert.equal(statusOf('yes'), 'met'); assert.equal(statusOf('no'), 'missing'); assert.equal(statusOf('somewhat'), 'unknown');
// Measured values outrank the AI reading.
const fewRefs = normalizePaperSkeleton([{ id: 'references', status: 'met', evidence: 'not found' }, { id: 'abstract', status: 'met', evidence: 'not found' }], `## Abstract\n${words(120)}\n## Introduction\nText\n## References\n[1] A. Paper.\n[2] B. Paper.`);
assert.equal(fewRefs.find(item => item.id === 'references')!.status, 'partly');
assert.match(fewRefs.find(item => item.id === 'references')!.measured!, /fewer than 20 measured/);
assert.equal(fewRefs.find(item => item.id === 'abstract')!.status, 'partly');
assert.equal(normalizePaperSkeleton([{ id: 'references', status: 'met', evidence: 'not found' }], bib).find(item => item.id === 'references')!.status, 'met');
const legacyStructured = { ...parsed, paperSkeleton: undefined, appliedSkills: [] };
assert.equal(submissionReviewStructuredSchema.safeParse(legacyStructured).success, true, 'Saved reviews without the checklist still parse.');
console.log('Skeleton sections passed: empty input, partial evidence, all rule areas, bounded input, PDRA verdict enum and re-evaluation dates, legacy labels, measured Paper Skeleton counts and checklist parsing.');
