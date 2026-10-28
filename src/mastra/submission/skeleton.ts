import { z } from 'zod';

export const skeletonFields = [
  { key: 'claim', label: 'Central claim and contributions', hint: 'State what the paper contributes, how, and with what result. Map each contribution to evidence.' },
  { key: 'technical', label: 'Baselines, results and ablations', hint: 'Give completed baseline results, the observed difference and the agreed ablation plan. Distinguish results from planned work.' },
  { key: 'outline', label: 'Paper outline', hint: 'List sections from abstract to conclusion, with the purpose of each section.' },
  { key: 'figures', label: 'Figures and tables', hint: 'Describe the teaser, motivation figure, result plots and table placeholders, including draft captions.' },
  { key: 'stressTest', label: 'Literature and reviewer stress test', hint: 'Record recent related-work checks, abstract/introduction feedback and the top three reasons to reject.' },
  { key: 'resources', label: 'Compute and data readiness', hint: 'Give evidence for available data, access permissions, compute bookings and remaining resource needs.' },
  { key: 'ethics', label: 'Authorship and ethics', hint: 'Record agreed contributions and author order, ethics approval and any safe-haven or access restrictions.' },
  { key: 'actions', label: 'Remaining actions, owners and dates', hint: 'For each blocker, name the responsible person, deadline and evidence needed before writing can proceed.' },
] as const;
export const skeletonDraftSchema = z.object(Object.fromEntries(skeletonFields.map(field => [field.key, z.string().max(6000).default('')])) as Record<(typeof skeletonFields)[number]['key'], z.ZodDefault<z.ZodString>>).strict();
export type SkeletonDraft = z.infer<typeof skeletonDraftSchema>;
export function renderSkeletonDraft(input: SkeletonDraft): string {
  const draft = skeletonDraftSchema.parse(input);
  if (!skeletonFields.some(field => draft[field.key].trim())) throw new Error('Add evidence to at least one skeleton section before checking.');
  return skeletonFields.map(field => `## ${field.label}\n${draft[field.key].trim() || '[Not provided]'}`).join('\n\n');
}
