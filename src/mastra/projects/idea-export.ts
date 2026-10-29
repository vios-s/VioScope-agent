import JSZip from 'jszip';
import type { Browser } from 'playwright';
import { AuthError } from '../auth/session';
import { ideaFields, type IdeaCheckPayload, type PitchExportFormat } from './idea-check';

// Keep this projection explicit: private source text, review reports and old versions never leave here.
export function approvedPitchDocument(payload: IdeaCheckPayload, version: number) {
  const current = payload.current;
  if (!current || current.version !== version) throw new AuthError('The pitch changed. Reload before downloading.', 409, 'conflict');
  if (current.decision?.outcome !== 'proceed') throw new Error('Confirm a human Proceed decision before downloading an approved pitch.');
  const date = new Date(current.at);
  const recordedAt = Number.isNaN(date.getTime()) ? current.at : date.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short' });
  return {
    title: payload.pitch.title,
    introduction: `Approved idea pitch for @${payload.pitch.ownerUsername}. Human Proceed decision recorded by @${current.by} on ${recordedAt}. Version ${current.version}.`,
    sections: [
      { heading: 'Track', text: current.draft.track || 'Not recorded' },
      ...ideaFields.map(field => ({ heading: field.label, text: current.draft[field.key] || '' })),
      { heading: 'Human decision and evidence', text: current.decision.rationale },
      { heading: 'Agreed next step', text: current.decision.nextMilestone },
    ],
  };
}
type PitchDocument = ReturnType<typeof approvedPitchDocument>;
const xml = (value: string) => value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
const markdown = (value: string) => value.replace(/([\\`*_{}\[\]()#+.!|>~-])/g, '\\$1');
function wordParagraph(text: string, style = 'Normal') {
  return `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr><w:r>${text.split('\n').map(line => `<w:t xml:space="preserve">${xml(line)}</w:t>`).join('<w:br/>')}</w:r></w:p>`;
}
async function wordDocument(document: PitchDocument) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
  zip.file('word/styles.xml', `<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="22"/><w:color w:val="000000"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="140" w:line="276" w:lineRule="auto"/><w:widowControl/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="100"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="25"/></w:rPr></w:style></w:styles>`);
  const body = wordParagraph(document.title, 'Title') + wordParagraph(document.introduction) + document.sections.map(section => wordParagraph(section.heading, 'Heading1') + wordParagraph(section.text)).join('');
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
let activePdfExports = 0;
async function pdfDocument(document: PitchDocument) {
  if (activePdfExports >= 2) throw new AuthError('PDF export is busy. Try again shortly or choose Word.', 503, 'unavailable');
  activePdfExports++;
  let browser: Browser | undefined;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  try {
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ headless: true, timeout: 15000 });
    watchdog = setTimeout(() => { void browser?.close().catch(() => {}); }, 30000);
    const context = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: 'block' });
    await context.route('**/*', route => route.abort());
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${xml(document.title)}</title><style>@page{size:A4;margin:20mm}body{font:11pt Arial,"Noto Sans CJK SC",sans-serif;color:#000;line-height:1.35}h1{overflow-wrap:anywhere;font-size:18pt;margin:0 0 12pt}h2{font-size:12.5pt;margin:12pt 0 5pt;break-after:avoid}p{margin:0 0 9pt;white-space:pre-wrap;overflow-wrap:anywhere;widows:3;orphans:3}</style></head><body><h1>${xml(document.title)}</h1><p>${xml(document.introduction)}</p>${document.sections.map(section => `<h2>${xml(section.heading)}</h2><p>${xml(section.text)}</p>`).join('')}</body></html>`, { waitUntil: 'domcontentloaded', timeout: 10000 });
    return await page.pdf({ format: 'A4', preferCSSPageSize: true, printBackground: false });
  } catch { throw new Error('Could not generate PDF. Try again or choose Word. The server needs Playwright Chromium installed.'); } finally { if (watchdog) clearTimeout(watchdog); try { await browser?.close(); } finally { activePdfExports--; } }
}
export async function exportApprovedPitch(payload: IdeaCheckPayload, version: number, format: PitchExportFormat) {
  const document = approvedPitchDocument(payload, version);
  const filename = `idea-pitch-v${version}.${format}`;
  if (format === 'docx') return { filename, mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', body: await wordDocument(document) };
  if (format === 'pdf') return { filename, mime: 'application/pdf', body: await pdfDocument(document) };
  const content = format === 'md'
    ? `# ${markdown(document.title)}\n\n${markdown(document.introduction)}\n\n${document.sections.map(section => `## ${section.heading}\n\n${markdown(section.text)}`).join('\n\n')}\n`
    : `${document.title}\n\n${document.introduction}\n\n${document.sections.map(section => `${section.heading}\n${section.text}`).join('\n\n')}\n`;
  return { filename, mime: format === 'md' ? 'text/markdown; charset=utf-8' : 'text/plain; charset=utf-8', body: Buffer.from(content, 'utf8') };
}
