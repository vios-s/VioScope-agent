import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ideaDraftSchema, ideaFields } from '../src/mastra/projects/idea-check';
import { ideaReviewBlocks, validateIdeaReview } from '../src/mastra/projects/idea-review-schema';
import { agentPrompt, artifactSummaryPrompt, submissionReviewPrompt, englishResponsePolicy } from '../src/mastra/prompts';
for (const prompt of [agentPrompt.instructions, artifactSummaryPrompt.system, submissionReviewPrompt.system]) assert.ok(prompt.includes(englishResponsePolicy));
// The policy holds even when the user asks for another language; mostly non-English answers are regenerated once.
assert.match(englishResponsePolicy, /even when the user or any supplied content asks you to answer in another language/);
const { isMostlyNonEnglish } = await import('../src/mastra/language');
const hanAnswer = String.fromCodePoint(0x8fd9, 0x662f, 0x4e00, 0x4e2a, 0x56de, 0x7b54, 0x3002) + ' VioScope';
assert.equal(isMostlyNonEnglish(hanAnswer), true);
assert.equal(isMostlyNonEnglish(`The pitch quotes "${String.fromCodePoint(0x4e2d, 0x6587)}" verbatim, which is acceptable in an English answer.`), false);
assert.equal(isMostlyNonEnglish('Plain English answer.'), false);
assert.equal(isMostlyNonEnglish('123 - 456'), false);
const chatRoute = await readFile('app/api/chat/route.ts', 'utf8');
assert.match(chatRoute, /if \(isMostlyNonEnglish\(response\.text\)\) \{\s*response = await generate\(agentMessage \+ englishRetry\)/);
for (const root of ['app', 'src', 'public']) {
  async function scan(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await scan(path);
      else if (/\.(tsx?|jsx?|ya?ml|json|md|html|css|svg)$/.test(path)) assert.doesNotMatch(await readFile(path, 'utf8'), /\p{Script=Han}/u, `System-owned content must be English: ${path}`);
    }
  }
  await scan(root);
}
console.log('English policy passed: application/source/public text and shared AI response instructions. User content and verbatim evidence are preserved.');

const originalText = String.fromCodePoint(0x4e2d, 0x6587);
const draft = ideaDraftSchema.parse(Object.fromEntries(ideaFields.map(field => [field.key, originalText])));
const report = { summary: 'Clarify the proposal.', blocks: ideaReviewBlocks.map(block => ({ block, status: 'needs_work', focus: [], gap: 'The claim needs a test.', improvement: 'Define a baseline comparison.', evidence: [{ field: block, quote: originalText }] })), discussant: { delta: { status: 'partial', answer: 'The delta is stated but not compared with a baseline.', evidence: [{ field: 'context', quote: originalText }] }, poc: { status: 'unanswered', answer: 'The pitch does not say what happens if the proof of concept fails.', evidence: [] } }, nextSteps: ['Specify the comparison.'] };
assert.doesNotThrow(() => validateIdeaReview(report, draft), 'Original evidence remains verbatim.');
assert.throws(() => validateIdeaReview({ ...report, summary: originalText }, draft), /must be in English/);
assert.throws(() => validateIdeaReview({ ...report, discussant: { ...report.discussant, poc: { ...report.discussant.poc, answer: originalText } } }, draft), /must be in English/);
