import 'dotenv/config';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { checkedSource, extractDocumentText, extractPitchUpload, organizePitchSource, suggestedPitchTitle, validatePitchExtraction } from '../src/mastra/projects/idea-import';
import { loadIdeaPitchRules, reviewIdeaPitch } from '../src/mastra/projects/idea-review';
import { ideaDraftSchema } from '../src/mastra/projects/idea-check';

const source = 'Can a smaller model retain accuracy?';
assert.equal((await extractPitchUpload(new File([source], 'pitch.txt'))).text, source);
assert.equal((await extractPitchUpload(new File([source], 'pitch.md'))).text, source);
const doc = new JSZip(); doc.file('word/document.xml', `<w:document><w:body><w:p><w:r><w:t>${source}</w:t></w:r></w:p></w:body></w:document>`);
assert.equal((await extractPitchUpload(new File([await doc.generateAsync({ type: 'arraybuffer' })], 'pitch.docx'))).text, source);
// Word splits formatted text into runs: one paragraph must stay one line with its spaces, in document order.
const mixed = new JSZip(); mixed.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
  <w:p><w:r><w:t>Pitch title</w:t></w:r></w:p>
  <w:p><w:r><w:t xml:space="preserve">The model is </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>much</w:t></w:r><w:r><w:t xml:space="preserve"> faster &amp; cheaper.</w:t></w:r></w:p>
  <w:p><w:r><w:t>Data</w:t><w:tab/><w:t>Compute</w:t><w:br/><w:t>Second line</w:t></w:r></w:p>
  <w:tbl><w:tr><w:tc><w:p><w:r><w:t>Cell A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Cell B</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
  <w:p><w:del><w:r><w:delText>deleted</w:delText></w:r></w:del><w:r><w:t>Last</w:t></w:r></w:p>
</w:body></w:document>`);
const mixedBytes = await mixed.generateAsync({ type: 'arraybuffer' });
const mixedText = 'Pitch title\nThe model is much faster & cheaper.\nData\tCompute\nSecond line\nCell A\tCell B\nLast';
assert.equal((await extractPitchUpload(new File([mixedBytes], 'mixed.docx'))).text, mixedText);
assert.equal(await extractDocumentText(new File([mixedBytes], 'mixed.docx')), mixedText, 'Skeleton Lock uses the same DOCX extraction.');
await assert.rejects(extractDocumentText(new File(['plain'], 'notes.txt')), /DOCX and text-based PDF/);
// Template headings are stripped from extracted blocks; a leading title line is only a suggestion.
const headed = '# [Demo] Sparse routing\n\nTrack: A\n\n## 1. The Why (The Hook)\nThe Pain Point: routing is slow.\n\n**2. The Context:**\nThe Giants: MoE.\n\n## 3. The What';
const stripped = validatePitchExtraction({ why: '## 1. The Why (The Hook)\nThe Pain Point: routing is slow.\n\n**2. The Context:**', context: '**2. The Context:**\nThe Giants: MoE.' }, headed);
assert.equal(stripped.why, 'The Pain Point: routing is slow.');
assert.equal(stripped.context, 'The Giants: MoE.');
assert.equal(validatePitchExtraction({ why: 'The Why it matters is cost.' }, 'The Why it matters is cost.').why, 'The Why it matters is cost.', 'Prose that starts like a heading is kept.');
assert.equal(suggestedPitchTitle(headed), '[Demo] Sparse routing');
assert.equal(suggestedPitchTitle('## 1. The Why\nText'), '');
assert.equal(suggestedPitchTitle('Track: A\nText'), '');
assert.equal(suggestedPitchTitle('Only one line'), '');
const deck = new JSZip(); deck.file('ppt/slides/slide1.xml', `<p:sld><a:p><a:r><a:t>${source}</a:t></a:r></a:p></p:sld>`);
assert.ok((await extractPitchUpload(new File([await deck.generateAsync({ type: 'arraybuffer' })], 'pitch.pptx'))).text.includes(source));
const stream = `BT /F1 12 Tf 50 750 Td (${source}) Tj ET`;
const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
let pdf = '%PDF-1.4\n'; const offsets = [0];
objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
const xref = Buffer.byteLength(pdf); pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
assert.ok((await extractPitchUpload(new File([pdf], 'pitch.pdf'))).text.includes(source));
await assert.rejects(extractPitchUpload(new File(['hello'], 'pitch.exe')), /Supported formats/);
await assert.rejects(extractPitchUpload(new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'pitch.txt')), /5 MB/);
assert.throws(() => checkedSource('x'.repeat(32001)), /32000/);
assert.throws(() => checkedSource(''), /No readable text/);
assert.throws(() => validatePitchExtraction({ question: 'Invented facts' }, source), /not present/);
assert.equal(validatePitchExtraction({ question: source }, source).question, source);
assert.equal(validatePitchExtraction({ coreIdea: source }, source).coreIdea, source);
assert.equal(validatePitchExtraction({ track: 'B' }, 'Track: B').track, 'B');
assert.throws(() => validatePitchExtraction({ track: 'A' }, source), /not explicitly stated/);
assert.throws(() => validatePitchExtraction({ experiment: 'Invented experiment' }, source), /not present/);
const dir = await mkdtemp(join(tmpdir(), 'idea-rules-'));
const previous = process.env.IDEA_PITCH_SKILL_PATH;
try {
  const path = join(dir, 'SKILL.md'); process.env.IDEA_PITCH_SKILL_PATH = path;
  await writeFile(path, 'First editable rules'); const first = await loadIdeaPitchRules();
  await writeFile(path, 'Changed editable rules'); const second = await loadIdeaPitchRules();
  assert.notEqual(first.rulesHash, second.rulesHash, 'Rules reload for each review.');
} finally {
  if (previous === undefined) delete process.env.IDEA_PITCH_SKILL_PATH; else process.env.IDEA_PITCH_SKILL_PATH = previous;
  await rm(dir, { recursive: true, force: true });
}
if (process.env.CHECK_IDEA_ELM === 'true') {
  const draft = ideaDraftSchema.parse({ question: source, importance: 'Lower inference cost could help small research teams.', contribution: 'Compare a compressed model with its full-size baseline; novelty is not yet established.', evidence: 'The working assumption is that many model parameters are redundant. No pilot results yet.', validation: 'Compare accuracy and latency on a held-out dataset with three seeds; report variance and failure cases.', resources: 'One researcher for two weeks using an existing GPU and a public dataset; verify dataset license first.', risks: 'Compression may harm rare examples. If accuracy falls, test a less aggressive compression ratio.', milestone: 'Alice will present a baseline comparison and failure cases in two weeks.' });
  const text = Object.entries(draft).map(([key, value]) => `${key}: ${value}`).join('\n\n');
  const extracted = await organizePitchSource(text);
  assert.ok(extracted.why);
  const review = await reviewIdeaPitch('Synthetic compression pitch', extracted);
  console.log(JSON.stringify({ liveElm: true, blocks: review.report.blocks.map(item => `${item.block}:${item.status}`), discussant: [review.report.discussant.delta.status, review.report.discussant.poc.status], rulesHash: review.rulesHash.slice(0, 12) }));
}
console.log('Idea import passed: TXT, MD, DOCX (ordered runs, tabs, breaks, tables), template heading stripping, title suggestion, PPTX, PDF, upload limits, no invented extracted text and editable rule reload.');
