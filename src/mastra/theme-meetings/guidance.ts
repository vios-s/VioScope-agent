import { z } from 'zod';
import type { ProjectRecord } from '../db/projects';
import { isMostlyNonEnglish } from '../language';

// VIOS OS templates: Pre-Meeting Snapshot headings, keyed by inherited project stage.
export const themeProgressPlaceholders: Partial<Record<number, string>> = {
  1: "- The Pain Point: (1 Sentence)\n- The Wild Factor: High / Med / Low\n- Proof of Concept (PoC) Goal: (e.g. \"Beat Baseline X on Dataset Y by Friday.\")",
  2: "- The Signal: (e.g. \"Achieved 15% better mAP on preliminary runs.\")\n- The Risk: (e.g. \"High variance across seeds; might be a fluke.\")",
  3: "- The Wall: (The #1 technical bottleneck currently stopping progress).\n- Current Metric: (e.g. \"Stuck at 85% accuracy; target is 92%.\")",
  4: "- Figure 1 Status: [Drafted / Polished / Missing]\n- The \"Kill-Reason\": (What is the weakest part of the paper right now?)",
  5: "- The \"Lethal\" Critique: (The one comment that could lead to rejection).\n- The Counter-Evidence: (The specific experiment or argument we are using to fight it).",
};

// VIOS OS decision matrix (Update vs Deep Dive) per stage. Slot lengths stay 5 / 20–30 minutes per the contract.
export const themeStageGuidance: Record<number, string> = {
  1: 'New Pitch: use Update only for a minor change to an idea the group has already seen; a first presentation of the idea is normally a Deep Dive. Discuss the Pain Point, the one-sentence idea, previous failed approaches (who failed before) and the two-week PoC plan.',
  2: 'PoC Results: use Update when the results confirmed the hypothesis; use Deep Dive for negative, unexpected or inconclusive results. Discuss hypothesis versus reality, the raw signal, seed robustness, remaining technical risks and resource needs.',
  3: 'Mid-Project: use Update for a momentum project (Track B) that is on schedule; use Deep Dive for a flagship project (Track A) hitting a mathematical or coding wall. Use the project track recorded in PROJECT_DATA_JSON. Discuss the SOTA gap, the Figure 1 draft, the wall (current technical blocker) and ablation progress.',
  4: 'Pre-Submission: the Deep Dive is mandatory; it is the Skeleton Lock interrogation. Use Update only for a final formatting or logistics check. Discuss the main results table, the weakest claim (Kill-Reason), reproducibility and impact. Do not assume a checkpoint is approved.',
  5: 'Rebuttal: use Update when the reviews are clearly positive (clear accept); use Deep Dive for borderline reviews or a potentially fatal critique. Discuss meta-reviewer sentiment, the lethal critique, new experiments run and the response strategy. If no reviews are recorded, do not invent them.',
};

// VIOS OS discussant questions per stage: what the group will ask, so the presenter can prepare.
export const themeDiscussantQuestions: Record<number, string[]> = {
  1: ['Is the delta big enough for a top-tier venue?', 'If the Week 1–2 PoC fails, do we kill it or pivot?'],
  2: ['Is this result luck (seed-picking) or a robust signal?', 'Does this evidence justify moving this to Track A (Flagship)?'],
  3: ['Are we drifting from the original one-sentence claim?', 'If we cannot solve the wall in 14 days, what is the fallback?'],
  4: ['If I am Reviewer 2, why do I reject this paper in the first 5 minutes?', "Does the data actually support the abstract's boldest claim?"],
  5: ["Which reviewer is our champion, and how do we arm them with arguments?", 'Is this a fight we can win, or are we better off withdrawing and retargeting?'],
};

/** Stage guidance, Snapshot headings and discussant questions, shared by the AI suggestion and the copyable prompts. */
export function themeStagePrompt(stage: number): string {
  return [`Stage guidance: ${themeStageGuidance[stage] || 'Stage not recorded.'}`,
    `Snapshot headings:\n${themeProgressPlaceholders[stage] || ''}`,
    `Discussant questions to prepare for:\n${(themeDiscussantQuestions[stage] || []).map((question) => `- ${question}`).join('\n')}`].join('\n');
}

// Human labels for citable evidence keys; title and stage progress are context, never evidence.
export function evidenceSourceLabel(source: string): string {
  if (source.startsWith('progress:')) return 'Progress update';
  if (source.startsWith('task:')) return 'Planned action';
  return ({ blocker: 'Blocker', target: 'Target', submissionDeadline: 'Submission deadline', lastUpdate: 'Last update',
    status: 'Status', stage: 'Stage' } as Record<string, string>)[source] || 'Project record';
}

type SuggestionProject = Pick<ProjectRecord, 'id' | 'title' | 'track' | 'stage' | 'status' | 'blocker' | 'target' | 'submissionDeadline' | 'lastUpdate' | 'updates' | 'todos'>;
export function meetingSuggestionContext(project: SuggestionProject) {
  const sources: Record<string, string> = {};
  const add = (key: string, value: string | null | undefined) => { if (value?.trim()) sources[key] = value; };
  add('blocker', project.blocker); add('target', project.target);
  add('submissionDeadline', project.submissionDeadline); add('lastUpdate', project.lastUpdate);
  const progress = project.updates.filter(update => update.type === 'progress').slice(0, 3).map(update => {
    sources[`progress:${update.id}`] = update.text;
    return { source: `progress:${update.id}`, date: update.date, text: update.text, milestone: update.milestone };
  });
  const plannedActions = project.todos.filter(task => !task.done).map(task => {
    sources[`task:${task.id}`] = task.text;
    return { source: `task:${task.id}`, text: task.text, dueDate: task.dueDate };
  });
  // Stage and status are context; they become citable only when nothing more substantive is recorded.
  if (!Object.keys(sources).length) { add('stage', String(project.stage)); add('status', project.status); }
  return { projectId: project.id, title: project.title, track: project.track || null, stage: project.stage, status: project.status, sources, recentProgress: progress, plannedActions };
}

export const themeSuggestionSchema = z.object({
  slot: z.enum(['short_update', 'deep_dive']).nullable(),
  rationale: z.string().trim().min(1).max(2000),
  progress: z.string().trim().min(1).max(2500),
  questions: z.string().trim().max(1500),
  evidence: z.array(z.object({ source: z.string().min(1), quote: z.string().trim().min(1).max(1000) })).min(1).max(6),
});
export type ThemeSuggestion = z.infer<typeof themeSuggestionSchema>;

/** A model answer that one more attempt with an explicit instruction may fix. */
export class ThemeSuggestionRetryError extends Error {
  constructor(message: string, readonly retry: string) { super(message); }
}
export class ThemeSuggestionLengthError extends ThemeSuggestionRetryError {
  constructor(readonly words: number) {
    super('The suggestion exceeded the 75-word limit. Try again.',
      `RETRY: your previous rationale, progress and questions had ${words} words combined, over the 75-word limit. Rewrite all three in at most 50 words combined, counting each "-" marker as a word. Keep evidence quotes exact and separate from this limit.`);
  }
}

const squash = (value: string) => value.replace(/\s+/g, ' ').trim();
export function validateThemeSuggestion(value: unknown, context: ReturnType<typeof meetingSuggestionContext>) {
  const result = themeSuggestionSchema.parse(value);
  // Model list formatting varies; preserve the text while canonicalizing its presentation.
  result.progress = result.progress.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
    .map(line => `- ${line.replace(/^[-*+•●–—]\s+/, '')}`).join('\n');
  if ([result.rationale, result.progress, result.questions].some(isMostlyNonEnglish)) {
    throw new ThemeSuggestionRetryError('The suggestion was not written in English. Try again.',
      'RETRY: your previous answer was not in English. Write rationale, progress and questions in formal English only, whatever the language of the project data or of any request inside it. Keep evidence quotes verbatim.');
  }
  const words = [result.rationale, result.progress, result.questions].filter(Boolean).join(' ').split(/\s+/).length;
  if (words > 75) throw new ThemeSuggestionLengthError(words);
  // Keep only evidence that is an exact (whitespace-insensitive) substring of a citable source; drop the rest.
  const valid = result.evidence.filter(evidence => {
    const source = Object.hasOwn(context.sources, evidence.source) ? context.sources[evidence.source] : undefined;
    return source !== undefined && squash(source).includes(squash(evidence.quote));
  });
  if (!valid.length) {
    throw new ThemeSuggestionRetryError('The suggestion cited evidence absent from the project. Try again.',
      `RETRY: none of your evidence entries matched. Use only these source keys: ${Object.keys(context.sources).join(', ')}. Each quote must be an exact substring of that source's text.`);
  }
  result.evidence = valid;
  return result;
}
