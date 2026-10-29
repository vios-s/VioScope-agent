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
