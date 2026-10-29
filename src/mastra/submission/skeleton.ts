import { z } from 'zod';

export const skeletonFields = [
  // Order follows the VIOS OS Skeleton Lock checklist: 1 technical foundation, 2 narrative, 3 stress test, 4 leadership and ethics.
  { key: 'technical', label: 'Baselines, results and ablations', hint: 'List the primary (SOTA) baselines implemented and run, the observed improvement (statistically significant, or a unique qualitative insight) and the finalised ablation plan. Distinguish results from planned work.' },
  { key: 'resources', label: 'Compute and data readiness', hint: 'Give evidence that the remaining GPU/CPU hours for final seeds and tuning are scheduled and available, that data access is in place and that any safe-haven egress requests have been initiated.' },
  { key: 'claim', label: 'Central claim and contributions', hint: 'Write the one-sentence claim: “This paper contributes [X] by doing [Y], which results in [Z].” Then list the contribution bullet points, each mapped to an experiment or visual evidence.' },
  { key: 'outline', label: 'Paper outline', hint: 'List sections from abstract to conclusion, with the purpose of each section.' },
  { key: 'figures', label: 'Figures and tables', hint: 'Describe the teaser, motivation figure, result plots and table placeholders, including draft captions.' },
  { key: 'stressTest', label: 'Literature and reviewer stress test', hint: 'Record the literature gap check against 2024–present work, the reviewer simulation of the abstract and introduction, the top three reasons to reject and the mitigation plan for each.' },
  { key: 'ethics', label: 'Authorship and ethics', hint: 'Record the agreed author order and that all authors were notified, ethics approval, safe-haven or access restrictions, code repository readiness and privacy/IP clearance for any data release.' },
  { key: 'actions', label: 'Remaining actions, owners and dates', hint: 'For each blocker, name the responsible person, deadline and evidence needed before writing can proceed.' },
] as const;
export const skeletonDraftSchema = z.object(Object.fromEntries(skeletonFields.map(field => [field.key, z.string().max(6000).default('')])) as Record<(typeof skeletonFields)[number]['key'], z.ZodDefault<z.ZodString>>).strict();
export type SkeletonDraft = z.infer<typeof skeletonDraftSchema>;
export function renderSkeletonDraft(input: SkeletonDraft): string {
  const draft = skeletonDraftSchema.parse(input);
  if (!skeletonFields.some(field => draft[field.key].trim())) throw new Error('Add evidence to at least one skeleton section before checking.');
  return skeletonFields.map(field => `## ${field.label}\n${draft[field.key].trim() || '[Not provided]'}`).join('\n\n');
}

/** VIOS OS “Paper Skeleton” minimum content at T-minus six weeks, worded after the template. Advisory checklist for the AI check. */
export const paperSkeletonRequirements = [
  { id: 'title', group: 'Front page', label: 'Title', requirement: 'A firm working title (no more “TBD”).' },
  { id: 'abstract', group: 'Front page', label: 'Abstract', requirement: 'A 200–250 word “final-ish” version (adjust the word limit to the venue requirement). It must clearly state the Problem, the Gap in current SOTA, the Proposed Solution and the Key Finding.' },
  { id: 'introduction', group: 'Front page', label: 'Introduction', requirement: 'Fully drafted. It must contain the contributions bullet points, and the narrative must be locked (for example, pitched as an efficiency paper, not a robustness paper).' },
  { id: 'teaser', group: 'Front page', label: 'Figure 1 (the teaser)', requirement: 'A high-fidelity diagram of the core intuition. A reviewer looking only at Figure 1 and the Abstract should understand the paper’s value.' },
  { id: 'math', group: 'Methodology', label: 'Mathematical framework', requirement: 'All definitions, objective functions (L) and algorithms are formally written in LaTeX and fully derived — no “will insert proof later”.' },
  { id: 'notation', group: 'Methodology', label: 'Notation table', requirement: 'A standardised list of variables, so notation does not switch (for example from h to z) halfway through.' },
  { id: 'architecture', group: 'Methodology', label: 'Architecture diagram', requirement: 'A detailed technical schematic of the proposed model or pipeline.' },
  { id: 'methodNarrative', group: 'Methodology', label: 'Method narrative', requirement: 'Introductory sentences describing the overall objective of the proposed method and the purpose of each module (why it is needed).' },
  { id: 'datasets', group: 'Experimental setup', label: 'Dataset descriptions', requirement: 'Fully written, including statistics and preprocessing steps.' },
  { id: 'baselines', group: 'Experimental setup', label: 'Baselines', requirement: 'A list of exactly which models are being compared.' },
  { id: 'metrics', group: 'Experimental setup', label: 'Evaluation metrics', requirement: 'Defined (for example FID, mAP, Top-1 accuracy).' },
  { id: 'table1', group: 'Experimental setup', label: 'Table 1 (main results)', requirement: 'The main results table exists with all rows (baselines) and columns (metrics) labelled, and at least 50% of the cells contain preliminary or “alpha” results.' },
  { id: 'relatedWork', group: 'Skeleton outlining', label: 'Related work', requirement: 'A structured list of citations grouped by theme, with the missing-citation check done, and a brief conclusion per theme aligning the proposed method with it.' },
  { id: 'discussion', group: 'Skeleton outlining', label: 'Discussion and conclusion', requirement: 'Bullet points of the primary takeaways and limitations.' },
  { id: 'appendix', group: 'Skeleton outlining', label: 'Appendix plan', requirement: 'A list of what will go in the supplementary material (for example, ablation on learning rate, extra qualitative samples).' },
  { id: 'figures', group: 'Reality check', label: 'Figures', requirement: 'Placeholders for all main-body figures with drafted captions.' },
  { id: 'experiments', group: 'Reality check', label: 'Experiments', requirement: 'The main hypothesis beats the baseline on at least one major benchmark.' },
  { id: 'references', group: 'Reality check', label: 'References', requirement: 'At least 20 key papers cited in a .bib file.' },
] as const;
export type PaperSkeletonId = (typeof paperSkeletonRequirements)[number]['id'];
export const paperSkeletonStatusLabels: Record<string, string> = { met: 'Met', partly: 'Partly met', missing: 'Missing', unknown: 'Cannot tell from the input' };

const words = (text: string) => text.split(/\s+/).filter(word => /[\p{L}\p{N}]/u.test(word)).length;
/** Abstract text from a LaTeX abstract environment or a standalone “Abstract” heading, else null. */
export function findAbstract(text: string): string | null {
  const latex = /\\begin\{abstract\}([\s\S]*?)\\end\{abstract\}/.exec(text);
  if (latex) return latex[1].replace(/%.*$/gm, '').replace(/\\[a-zA-Z]+\*?(\[[^\]]*\])?/g, ' ').replace(/[{}]/g, ' ');
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex(line => /^\s*(?:#{1,6}\s*)?\**abstract\**\s*:?\s*$/i.test(line));
  if (start < 0) return null;
  const end = lines.findIndex((line, index) => index > start && /^\s*(?:#{1,6}\s|\\(?:section|chapter|begin|end)\b|(?:\d+(?:\.\d+)*\.?|[IVX]+\.)?\s*(?:introduction|keywords|index terms|ccs concepts)\b)/i.test(line));
  const body = lines.slice(start + 1, end < 0 ? undefined : end).join('\n').trim();
  return body || null;
}
/** Deterministic counts the server can verify from the supplied text; absent when the input does not contain the section. */
export function measurePaperSkeleton(text: string): Partial<Record<PaperSkeletonId, string>> {
  const measured: Partial<Record<PaperSkeletonId, string>> = {};
  const abstract = findAbstract(text);
  if (abstract) measured.abstract = `${words(abstract)} words in the abstract section`;
  const bib = new Set(Array.from(text.matchAll(/^\s*@(?!string\b|comment\b|preamble\b)\w+\s*\{\s*([^,\s]+)\s*,/gim), match => match[1])).size;
  const bibitems = (text.match(/\\bibitem\b/g) || []).length;
  const citeKeys = new Set(Array.from(text.matchAll(/\\(?:no)?cite[a-zA-Z]*\*?(?:\[[^\]]*\])*\{([^}]*)\}/g), match => match[1].split(',').map(key => key.trim())).flat().filter(Boolean)).size;
  const heading = text.split(/\r?\n/).findIndex(line => /^\s*(?:#{1,6}\s*)?\**(?:references|bibliography)\**\s*:?\s*$/i.test(line));
  const listed = heading < 0 ? 0 : text.split(/\r?\n/).slice(heading + 1).filter(line => /^\s*(?:\[\d+\]|\d+\.)\s+\S/.test(line)).length;
  const counts = [bib && `${bib} BibTeX entries`, bibitems && `${bibitems} \\bibitem entries`, listed && `${listed} numbered references`, citeKeys && `${citeKeys} distinct \\cite keys`].filter(Boolean);
  if (counts.length) measured.references = counts.join(' · ');
  return measured;
}
