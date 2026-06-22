import { generateObject } from 'ai';
import { elmChatModel } from '../llm';
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
  return `Run a VIOS B2 pre-submission review using the supplied runtime skills.

Context:
- Draft name: ${draft.name}
- Target venue: ${targetVenue || 'not provided'}
- Deadline: ${deadline || 'not provided'}
- Draft was truncated: ${draftTruncated ? 'yes' : 'no'}
- Skills to apply: ${skills.map((skill) => `${skill.name}${skill.version ? `@${skill.version}` : ''}`).join(', ')}

Instructions:
- Be advisory, not authoritative. A human signs off.
- Use only evidence visible in the numbered draft and the supplied skill instructions.
- Cite draft evidence with line references like \`draft:L12-L18\`.
- If evidence is missing, write "missing" and explain what the user should provide.
- Do not invent experiments, results, citations, deadlines, or author decisions.
- Suggest one overall verdict: CLEARED, CONDITIONAL, or SLIDE.
- Also provide per-skill findings.

Required structured output:
- verdict must be exactly CLEARED, CONDITIONAL, or SLIDE.
- summary should be short and decision-oriented.
- findings must use status pass, partial, fail, missing, or conditional.
- findings evidence must contain draft line references like \`draft:L12-L18\`, or the string "missing".
- reasonsToReject should list blocking risks only. Use an empty array when none are visible.
- checkmateQuestions should list the hardest questions a reviewer, PI, or external critic would ask.
- mitigations should use priority P0, P1, P2, or P3.
- humanSignOff must stay pending unless the draft itself explicitly records sign-off.
- perSkillNotes must include one entry for each supplied skill.
- Use "missing", "pending", or "not applicable" for unknown text fields. Do not leave important fields blank.

Runtime skills:

${buildSkillsBlock(skills)}

Numbered draft:

${numberedDraft}
`;
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

  const result = await generateObject({
    model: elmChatModel,
    system:
      'You are VioScope running a VIOS pre-submission review harness. Be concise, evidence-backed, and explicit about uncertainty. Never claim human approval.',
    prompt,
    schema: submissionReviewModelOutputSchema,
    schemaName: 'VioScopeSubmissionReview',
    schemaDescription: 'Structured VIOS B2 pre-submission review result with evidence-backed findings.',
    maxOutputTokens: input.maxOutputTokens || defaultMaxOutputTokens,
    experimental_repairText: async ({ text }) => extractJsonObject(text),
  });
  const structured = submissionReviewStructuredSchema.parse({
    ...result.object,
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
