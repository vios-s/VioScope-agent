import { z } from 'zod';
import type { ProjectRecord } from '../db/projects';

// VIOS OS templates: Pre-Meeting Snapshot headings, keyed by inherited project stage.
export const themeProgressPlaceholders: Partial<Record<number, string>> = {
  1: "- The Pain Point: (1 Sentence)\n- The Wild Factor: High / Med / Low\n- Proof of Concept (PoC) Goal: (e.g. \"Beat Baseline X on Dataset Y by Friday.\")",
  2: "- The Signal: (e.g. \"Achieved 15% better mAP on preliminary runs.\")\n- The Risk: (e.g. \"High variance across seeds; might be a fluke.\")",
  3: "- The Wall: (The #1 technical bottleneck currently stopping progress).\n- Current Metric: (e.g. \"Stuck at 85% accuracy; target is 92%.\")",
  4: "- Figure 1 Status: [Drafted / Polished / Missing]\n- The \"Kill-Reason\": (What is the weakest part of the paper right now?)",
  5: "- The \"Lethal\" Critique: (The one comment that could lead to rejection).\n- The Counter-Evidence: (The specific experiment or argument we are using to fight it).",
};

export const themeStageGuidance: Record<number, string> = {
  1: 'New Pitch: use Update for a minor change to an already-discussed idea; use Deep Dive for a first presentation. Discuss the one-sentence idea, previous failed approaches and the two-week PoC plan.',
  2: 'PoC Results: use Update when evidence confirms the hypothesis; use Deep Dive for negative, unexpected or inconclusive results. Discuss hypothesis versus reality, raw signal, seed robustness, technical risks and resource needs.',
  3: 'Mid-Project: use Update for steady progress; use Deep Dive for a technical wall. Discuss the SOTA gap, Figure 1, ablations and a fallback if the blocker remains unresolved.',
  4: 'Pre-Submission: use Update for formatting or logistics; use Deep Dive for a Skeleton Lock discussion. Discuss main results, weakest claim, reproducibility and impact. Do not assume a checkpoint is approved.',
  5: 'Rebuttal: use Update for clearly positive reviews; use Deep Dive for borderline reviews or a potentially fatal critique. Discuss reviewer sentiment, counter-evidence and response strategy. If no reviews exist, do not invent them.',
};

type SuggestionProject = Pick<ProjectRecord, 'id' | 'title' | 'stage' | 'stageProgress' | 'status' | 'blocker' | 'target' | 'submissionDeadline' | 'lastUpdate' | 'updates' | 'todos'>;
export function meetingSuggestionContext(project: SuggestionProject) {
  const sources: Record<string, string> = {
    title: project.title, stage: String(project.stage), stageProgress: String(project.stageProgress),
    status: project.status, blocker: project.blocker || '', target: project.target || '',
    submissionDeadline: project.submissionDeadline || '', lastUpdate: project.lastUpdate || '',
  };
  const progress = project.updates.filter(update => update.type === 'progress').slice(0, 3).map(update => {
    sources[`progress:${update.id}`] = update.text;
    return { id: update.id, date: update.date, text: update.text, milestone: update.milestone };
  });
  return { projectId: project.id, stage: project.stage, sources, recentProgress: progress,
    plannedActions: project.todos.filter(task => !task.done).map(task => ({ text: task.text, dueDate: task.dueDate })) };
}

export const themeSuggestionSchema = z.object({
  slot: z.enum(['short_update', 'deep_dive']).nullable(),
  rationale: z.string().trim().min(1).max(2000),
  progress: z.string().trim().min(1).max(2500),
  questions: z.string().trim().max(1500),
  evidence: z.array(z.object({ source: z.string().min(1), quote: z.string().trim().min(1).max(1000) })).min(1).max(6),
});
export type ThemeSuggestion = z.infer<typeof themeSuggestionSchema>;
export class ThemeSuggestionLengthError extends Error {
  constructor(readonly words: number) { super('The suggestion exceeded the 75-word limit. Try again.'); }
}
export function validateThemeSuggestion(value: unknown, context: ReturnType<typeof meetingSuggestionContext>) {
  const result = themeSuggestionSchema.parse(value);
  // Model list formatting varies; preserve the text while canonicalizing its presentation.
  result.progress = result.progress.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
    .map(line => `- ${line.replace(/^[-*+•●–—]\s+/, '')}`).join('\n');
  const words = result.progress.split(/\s+/).length;
  if (words > 75) throw new ThemeSuggestionLengthError(words);
  for (const evidence of result.evidence) {
    if (!context.sources[evidence.source]?.includes(evidence.quote)) throw new Error('The suggestion cited evidence absent from the project. Try again.');
  }
  return result;
}
