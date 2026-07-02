import { generateText } from 'ai';
import { elmChatModel } from '../llm';
import { renderPromptTemplate, submissionReviewPrompt } from '../prompts';
import { runtimeEnvNumber } from '../runtime-config';
import { readViosSkill, type ViosSkill } from '../skills/loader';
import { readDraftFile, type DraftSource } from './draft';
import {
  submissionReviewModelOutputSchema,
  submissionReviewStructuredSchema,
  type SubmissionReviewStructured,
} from './schema';

export const defaultSubmissionReviewSkills = [
  'vios-skeleton-lock',
  'vios-pdra-meta-review',
  'vios-internal-red-team',
  'vios-revision-lock',
] as const;

export type SubmissionReviewInput = {
  draftPath?: string;
  draftText?: string;
  draftName?: string;
  skills?: string[];
  targetVenue?: string;
  deadline?: string;
  maxDraftChars?: number;
  maxOutputTokens?: number;
};

export type SubmissionReviewResult = {
  report: string;
  structured: SubmissionReviewStructured;
  draftName: string;
  skills: Array<{
    name: string;
    version?: string;
    sourcePath: string;
  }>;
  draftTruncated: boolean;
  draftChars: number;
  finishReason: string;
};

const defaultMaxDraftChars = runtimeEnvNumber('SUBMISSION_REVIEW_MAX_DRAFT_CHARS', 60000);
const defaultMaxOutputTokens = runtimeEnvNumber('SUBMISSION_REVIEW_MAX_OUTPUT_TOKENS', 5000);

function normalizeSkillNames(skills?: string[]): string[] {
  const names = skills?.length ? skills : [...defaultSubmissionReviewSkills];
  return [...new Set(names.map((skill) => skill.trim()).filter(Boolean))];
}

async function resolveDraft(input: SubmissionReviewInput): Promise<DraftSource> {
  if (input.draftText?.trim()) {
    return {
      name: input.draftName || 'inline-draft',
      text: input.draftText,
    };
  }

  if (!input.draftPath) {
    throw new Error('Provide either draftPath or draftText.');
  }

  return readDraftFile(input.draftPath);
}

async function resolveSkills(skillNames: string[]): Promise<ViosSkill[]> {
  const loadedSkills: ViosSkill[] = [];
  const errors: string[] = [];

  for (const name of skillNames) {
    const { skill, result } = await readViosSkill(name);
    const validationErrors = result.issues.filter((issue) => issue.severity === 'error');

    if (validationErrors.length) {
      errors.push(...validationErrors.map((issue) => `${issue.file || name}: ${issue.message}`));
    }

    if (!skill) {
      errors.push(`Skill not found: ${name}`);
      continue;
    }

    loadedSkills.push(skill);
  }

  if (errors.length) {
    throw new Error(`Cannot run submission review:\n${errors.map((error) => `- ${error}`).join('\n')}`);
  }

  return loadedSkills;
}

function numberDraftLines(text: string, maxChars: number): { text: string; truncated: boolean; chars: number } {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  const draftText = normalized.length > maxChars ? normalized.slice(0, maxChars) : normalized;
  const numbered = draftText
    .split('\n')
    .map((line, index) => `${String(index + 1).padStart(4, '0')}: ${line}`)
    .join('\n');

  return {
    text: numbered,
    truncated: normalized.length > maxChars,
    chars: draftText.length,
  };
}

function buildSkillsBlock(skills: ViosSkill[]): string {
  return skills
    .map(
      (skill) => `## ${skill.name}${skill.version ? ` v${skill.version}` : ''}

Source: ${skill.sourcePath}

${skill.markdown}`,
    )
    .join('\n\n---\n\n');
}

function skillMetadata(skills: ViosSkill[]): SubmissionReviewStructured['appliedSkills'] {
  return skills.map((skill) => ({
    name: skill.name,
    version: skill.version || '',
    sourcePath: skill.sourcePath,
  }));
}

function escapeTableCell(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    return 'missing';
  }

  return normalized.replace(/\r?\n/g, '<br>').replace(/\|/g, '\\|');
}

function renderList(items: string[]): string {
  if (!items.length) {
    return '1. None identified.';
  }

  return items.map((item, index) => `${index + 1}. ${item}`).join('\n');
}

function renderSubmissionReviewMarkdown(review: SubmissionReviewStructured): string {
  const appliedSkills = review.appliedSkills
    .map(
      (skill) =>
        `| ${escapeTableCell(skill.name)} | ${escapeTableCell(skill.version || 'unknown')} | ${escapeTableCell(skill.sourcePath)} |`,
    )
    .join('\n');

  const findings = review.findings
    .map(
      (finding) =>
        `| ${escapeTableCell(finding.area)} | ${escapeTableCell(finding.status)} | ${escapeTableCell(
          finding.evidence.length ? finding.evidence.join(', ') : 'missing',
        )} | ${escapeTableCell(finding.gap)} | ${escapeTableCell(finding.requiredAction)} |`,
    )
    .join('\n');

  const mitigations = review.mitigations
    .map(
      (mitigation) =>
        `| ${escapeTableCell(mitigation.priority)} | ${escapeTableCell(mitigation.risk)} | ${escapeTableCell(
          mitigation.action,
        )} | ${escapeTableCell(mitigation.owner)} | ${escapeTableCell(mitigation.due)} | ${escapeTableCell(
          mitigation.evidenceNeeded,
        )} |`,
    )
    .join('\n');

  const perSkillNotes = review.perSkillNotes
    .map((entry) => `### ${entry.skill}\n${entry.notes.length ? entry.notes.map((note) => `- ${note}`).join('\n') : '- No notes.'}`)
    .join('\n\n');

  return `# VIOS B2 Pre-Submission Review

## Overall Verdict
${review.verdict}

${review.summary}

## Applied Skills
| Skill | Version | Source |
|---|---|---|
${appliedSkills || '| missing | missing | missing |'}

## Evidence-Backed Findings
| Area | Status | Evidence | Gap | Required action |
|---|---|---|---|---|
${findings || '| missing | missing | missing | missing | missing |'}

## Reasons To Reject
${renderList(review.reasonsToReject)}

## Checkmate Questions
${renderList(review.checkmateQuestions)}

## Mitigation Table
| Priority | Risk | Action | Owner | Due | Evidence needed |
|---|---|---|---|---|---|
${mitigations || '| P3 | missing | missing | missing | missing | missing |'}

## Human Sign-Off
- Lead PDRA: ${review.humanSignOff.leadPdra || 'pending'}
- PI / organizer: ${review.humanSignOff.piOrOrganizer || 'pending'}
- Remaining evidence needed: ${
    review.humanSignOff.remainingEvidenceNeeded.length ? review.humanSignOff.remainingEvidenceNeeded.join('; ') : 'none identified'
  }

## Per-Skill Notes
${perSkillNotes || '### missing\n- No notes.'}
`;
}

function extractJsonObject(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    return text.slice(start, end + 1);
  }

  return null;
}

function parseReviewJson(text: string) {
  const json = extractJsonObject(text);
  if (!json) {
    throw new Error('Submission review model did not return a JSON object.');
  }

  try {
    return submissionReviewModelOutputSchema.parse(JSON.parse(json));
  } catch (error) {
    throw new Error(`Submission review model returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function buildPrompt({
  draft,
  numberedDraft,
  skills,
  targetVenue,
  deadline,
  draftTruncated,
}: {
  draft: DraftSource;
  numberedDraft: string;
  skills: ViosSkill[];
  targetVenue?: string;
  deadline?: string;
  draftTruncated: boolean;
}) {
  return renderPromptTemplate(submissionReviewPrompt.reviewTemplate, {
    draftName: draft.name,
    targetVenue: targetVenue || 'not provided',
    deadline: deadline || 'not provided',
    draftTruncated: draftTruncated ? 'yes' : 'no',
    skills: skills.map((skill) => `${skill.name}${skill.version ? `@${skill.version}` : ''}`).join(', '),
    runtimeSkills: buildSkillsBlock(skills),
    numberedDraft,
  });
}


export async function reviewSubmission(input: SubmissionReviewInput): Promise<SubmissionReviewResult> {
  const draft = await resolveDraft(input);
  const skills = await resolveSkills(normalizeSkillNames(input.skills));
  const maxDraftChars = input.maxDraftChars || defaultMaxDraftChars;
  const numberedDraft = numberDraftLines(draft.text, maxDraftChars);
  const prompt = buildPrompt({
    draft,
    numberedDraft: numberedDraft.text,
    skills,
    targetVenue: input.targetVenue,
    deadline: input.deadline,
    draftTruncated: numberedDraft.truncated,
  });
  const jsonPrompt = `${prompt}

${renderPromptTemplate(submissionReviewPrompt.jsonResponseTemplate, {
    exampleSkill: skills[0]?.name || 'skill-name',
  })}`;

  const result = await generateText({
    model: elmChatModel,
    system: submissionReviewPrompt.system,
    prompt: jsonPrompt,
    maxOutputTokens: input.maxOutputTokens || defaultMaxOutputTokens,
  });
  const structured = submissionReviewStructuredSchema.parse({
    ...parseReviewJson(result.text),
    appliedSkills: skillMetadata(skills),
  });

  return {
    report: renderSubmissionReviewMarkdown(structured),
    structured,
    draftName: draft.name,
    skills: skillMetadata(skills),
    draftTruncated: numberedDraft.truncated,
    draftChars: numberedDraft.chars,
    finishReason: result.finishReason,
  };
}
