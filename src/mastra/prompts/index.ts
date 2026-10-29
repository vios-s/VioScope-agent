import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

const textSchema = z.string().trim().min(1);

const agentPromptSchema = z.object({
  instructions: textSchema,
});

const artifactSummaryPromptSchema = z.object({
  system: textSchema,
  userTemplate: textSchema,
});

const submissionReviewPromptSchema = z.object({
  system: textSchema,
  reviewTemplate: textSchema,
  jsonResponseTemplate: textSchema,
});

export const uiCopyPromptsSchema = z.object({
  project: z.object({
    progress: textSchema,
    target: textSchema,
    blocker: textSchema,
  }),
  theme: z.object({
    progress: textSchema,
    questions: textSchema,
  }),
  chat: z.object({
    starterPrompts: z.array(textSchema).min(1),
  }),
});

export type UiCopyPrompts = z.infer<typeof uiCopyPromptsSchema>;

const promptFiles = {
  'agent.yaml': new URL('./agent.yaml', import.meta.url),
  'artifact-summary.yaml': new URL('./artifact-summary.yaml', import.meta.url),
  'submission-review.yaml': new URL('./submission-review.yaml', import.meta.url),
  'ui-copy.yaml': new URL('./ui-copy.yaml', import.meta.url),
  'theme-meeting-suggestion.yaml': new URL('./theme-meeting-suggestion.yaml', import.meta.url),
} as const;

function readPromptYaml(fileName: keyof typeof promptFiles): unknown {
  const promptPath = fileURLToPath(promptFiles[fileName]);
  return parseYaml(readFileSync(/* turbopackIgnore: true */ promptPath, 'utf8'));
}

export function renderPromptTemplate(template: string, values: Record<string, string | number | null | undefined>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => String(values[key] ?? ''));
}

export const englishResponsePolicy = 'Write all generated explanations, advice, summaries and recommendations in formal English, regardless of the input language. Preserve user-authored content, names and verbatim evidence quotations in their original language; do not translate or invent evidence.';

export const agentPrompt = agentPromptSchema.parse(readPromptYaml('agent.yaml'));
agentPrompt.instructions += `\n${englishResponsePolicy}`;
export const artifactSummaryPrompt = artifactSummaryPromptSchema.parse(readPromptYaml('artifact-summary.yaml'));
artifactSummaryPrompt.system += `\n${englishResponsePolicy}`;
export const submissionReviewPrompt = submissionReviewPromptSchema.parse(readPromptYaml('submission-review.yaml'));
submissionReviewPrompt.system += `\n${englishResponsePolicy}`;
export const uiCopyPrompts = uiCopyPromptsSchema.parse(readPromptYaml('ui-copy.yaml'));

export const ideaPitchSkillFile = new URL('./idea-pitch/SKILL.md', import.meta.url);

export const themeMeetingSuggestionPrompt = z.object({ system: textSchema }).parse(readPromptYaml('theme-meeting-suggestion.yaml'));
