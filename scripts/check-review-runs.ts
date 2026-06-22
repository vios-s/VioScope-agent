import 'dotenv/config';
import { createPostgresClient } from '../src/mastra/db/postgres';
import { getReviewRun, saveReviewRun, updateReviewCheckSignoff } from '../src/mastra/db/review-runs';

async function deleteRun(id: string): Promise<number> {
  const postgres = createPostgresClient('vioscope-review-runs-check-cleanup');

  try {
    const result = await postgres.pool.query('DELETE FROM review_runs WHERE id = $1 RETURNING id::text', [id]);
    return result.rowCount ?? 0;
  } finally {
    await postgres.disconnect();
  }
}

async function main() {
  const smokeResult = {
    report: '# Smoke Review\n\nThis is a deterministic fake review.',
    structured: {
      verdict: 'CONDITIONAL',
      summary: 'Smoke review summary.',
      appliedSkills: [
        {
          name: 'vios-skeleton-lock',
          version: '0.0.0',
          sourcePath: 'smoke',
        },
      ],
      findings: [],
      reasonsToReject: [],
      checkmateQuestions: [],
      mitigations: [],
      humanSignOff: {
        leadPdra: 'pending',
        piOrOrganizer: 'pending',
        remainingEvidenceNeeded: [],
      },
      perSkillNotes: [],
    },
    draftName: 'smoke-draft.md',
    draftTruncated: false,
    draftChars: 42,
    finishReason: 'stop',
  };

  const saved = await saveReviewRun({
    projectName: 'Smoke Project',
    draftName: 'smoke-draft.md',
    targetVenue: 'SmokeConf',
    deadline: '2026-09-15',
    initiator: 'Smoke Initiator',
    piOrSeniorReviewer: 'Smoke PI',
    cooperators: ['Smoke Cooperator'],
    reviewer: 'Smoke Reviewer',
    checks: [
      {
        skillName: 'vios-skeleton-lock',
        skillLabel: 'Skeleton Lock',
        verdict: 'CONDITIONAL',
        reportMarkdown: smokeResult.report,
        resultJson: smokeResult,
      },
    ],
  });

  const loaded = await getReviewRun(saved.id);
  if (loaded.checks.length !== 1) {
    throw new Error(`Expected 1 check, got ${loaded.checks.length}.`);
  }

  const updated = await updateReviewCheckSignoff({
    runId: saved.id,
    skillName: 'vios-skeleton-lock',
    signoffStatus: 'needs_revision',
    reviewerNote: 'Smoke needs revision.',
    signedOffBy: 'Smoke Reviewer',
  });

  const check = updated.checks[0];
  if (!check || check.signoffStatus !== 'needs_revision' || check.reviewerNote !== 'Smoke needs revision.') {
    throw new Error('Sign-off update did not persist.');
  }

  const deleted = await deleteRun(saved.id);
  console.log(
    JSON.stringify(
      {
        savedRunId: saved.id,
        loadedChecks: loaded.checks.length,
        signoffStatus: check.signoffStatus,
        deleted,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
