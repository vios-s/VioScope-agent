import 'dotenv/config';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { skeletonDraftSchema, renderSkeletonDraft } from '../src/mastra/submission/skeleton';
import { reviewSubmission } from '../src/mastra/submission/review';

export const syntheticSkeleton = skeletonDraftSchema.parse({
  claim: 'SYNTHETIC TEST ONLY. We hypothesize that a compressed cell-segmentation model reduces inference latency by 30% while losing at most two Dice points against the full-size baseline. This is a hypothesis, not an established contribution or novelty claim.',
  technical: 'The baseline implementation runs, but no held-out comparison has been completed. There are no measured Dice or latency results. The agreed ablations compare two compression levels with the same data split and training budget, over three seeds. These experiments are planned, not completed.',
  outline: 'Abstract: state the question and qualified findings. Introduction: motivate inexpensive microscopy. Related work: compare compression approaches. Methods: fixed split and compression protocol. Results: accuracy, latency, uncertainty and small-cell failures. Discussion: limitations. Conclusion: scope of the evidence.',
  figures: 'Teaser sketch contrasts a large and small model. Figure 1 will show the latency/Dice trade-off with uncertainty; its caption is a placeholder. Table 1 will contain three-seed comparisons. No figure or table contains final numbers. An empirical motivation figure is still missing.',
  stressTest: 'No recent literature search or independent reviewer simulation has been completed. Three possible rejection reasons are unverified novelty, no measured speed/accuracy trade-off, and small-cell errors. Mitigations are a documented literature comparison, controlled experiments, and size-stratified failure analysis.',
  resources: 'A synthetic student has one GPU reserved for two weeks. A public dataset is proposed, but its license and download permission have not been verified. No private patient records are used in this fictional example.',
  ethics: 'Author order has not been agreed. The fictional team has not recorded whether ethics review or a data-access approval is needed. Do not infer that a public dataset removes these obligations.',
  actions: 'The fictional lead researcher will document the dataset license by 2026-11-02, run baseline comparisons by 2026-11-09, and bring figures, limitations and authorship questions to the fictional PI on 2026-11-11. These are proposed dates, not human approval.',
});
const draftText = renderSkeletonDraft(syntheticSkeleton);
const output = resolve('.local/checks/skeleton-live');
await mkdir(output, { recursive: true });
const result = await reviewSubmission({ draftText, draftName: 'SYNTHETIC — Cell segmentation skeleton', skills: ['vios-skeleton-lock'], targetVenue: 'Fictional methods workshop', deadline: '2026-12-15' });
await writeFile(resolve(output, 'result.json'), JSON.stringify({ at: new Date().toISOString(), synthetic: true, draft: syntheticSkeleton, draftText, result }, null, 2));
await writeFile(resolve(output, 'report.md'), result.report);
assert.notEqual(result.structured.verdict, 'CLEARED', 'Missing experiments, license and authorship evidence must not clear the gate.');
assert.ok(result.structured.findings.some(item => ['missing', 'fail', 'partial', 'conditional'].includes(item.status)));
const lines = draftText.split('\n').length;
let citations = 0;
for (const finding of result.structured.findings) {
  for (const evidence of finding.evidence) {
    if (evidence.toLowerCase() === 'missing') continue;
    const match = /^draft:L(\d+)(?:-L?(\d+))?$/.exec(evidence);
    assert.ok(match, `Expected a draft citation or missing: ${evidence}`);
    const start = Number(match[1]), end = Number(match[2] || match[1]);
    assert.ok(start >= 1 && end >= start && end <= lines, `Citation outside supplied text: ${evidence}`);
    citations += 1;
  }
}
assert.ok(citations > 0, 'Review should cite supplied evidence.');
assert.ok(!/[\u4e00-\u9fff]/.test(result.report), 'Generated report must be English.');
console.log(JSON.stringify({ verdict: result.structured.verdict, findings: result.structured.findings.length, validCitations: citations, report: resolve(output, 'report.md') }));
