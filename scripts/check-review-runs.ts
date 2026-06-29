import 'dotenv/config';
import { createSessionToken, sessionCookieName } from '../src/mastra/auth/session';
import { createPostgresClient } from '../src/mastra/db/postgres';
import { getReviewRun, saveReviewRun, updateReviewCheckSignoff } from '../src/mastra/db/review-runs';
import { getUserByUsername, upsertLocalUser, type AuthUser } from '../src/mastra/db/users';

const stamp = Date.now().toString(36);
const routeUsers = {
  owner: `review.run.owner.${stamp}`,
  intruder: `review.run.intruder.${stamp}`,
};

async function deleteRun(id: string): Promise<number> {
  const postgres = createPostgresClient('vioscope-review-runs-check-cleanup');

  try {
    const result = await postgres.pool.query('DELETE FROM review_runs WHERE id = $1 RETURNING id::text', [id]);
    return result.rowCount ?? 0;
  } finally {
    await postgres.disconnect();
  }
}

async function cleanupUsers() {
  const postgres = createPostgresClient('vioscope-review-runs-user-cleanup');
  try {
    await postgres.pool.query('DELETE FROM users WHERE username = ANY($1::text[])', [Object.values(routeUsers)]).catch(() => undefined);
  } finally {
    await postgres.disconnect();
  }
}

async function seedUser(username: string): Promise<AuthUser> {
  await upsertLocalUser({
    username,
    displayName: username,
    email: `${username}@example.test`,
    password: 'ReviewRun1!',
    role: 'member',
    passwordResetRequired: false,
    source: 'review_run_check',
  });
  const user = await getUserByUsername(username);
  if (!user) throw new Error(`Expected ${username} to exist.`);
  return user;
}

function routeRequest(user: AuthUser, body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/review-runs', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: `${sessionCookieName}=${createSessionToken(user)}`,
    },
    body: JSON.stringify(body),
  });
}

function routeCheckBody(patch: Record<string, unknown> = {}) {
  return {
    draftName: 'route-smoke-draft.md',
    checks: [
      {
        skillName: 'vios-skeleton-lock',
        skillLabel: 'Skeleton Lock',
        verdict: 'CONDITIONAL',
        reportMarkdown: '# Route smoke review',
        resultJson: { ok: true },
        ...patch,
      },
    ],
  };
}

async function main() {
  await cleanupUsers();
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

  const reviewRunsRoute = await import('../app/api/review-runs/route');
  const owner = await seedUser(routeUsers.owner);
  const intruder = await seedUser(routeUsers.intruder);
  const ownerResponse = await reviewRunsRoute.POST(
    routeRequest(owner, routeCheckBody({ signoffStatus: 'accepted', signedOffBy: 'Forged Reviewer' })),
  );
  if (ownerResponse.status !== 200) {
    throw new Error(`Expected owner review run save to succeed, got ${ownerResponse.status}.`);
  }
  const ownerBody = await ownerResponse.json();
  const routeRun = ownerBody.run;
  if (routeRun.checks?.[0]?.signoffStatus !== 'pending' || routeRun.checks?.[0]?.signedOffBy) {
    throw new Error('Member route save should not accept forged sign-off fields.');
  }
  const intruderResponse = await reviewRunsRoute.POST(
    routeRequest(intruder, { ...routeCheckBody(), id: routeRun.id }),
  );
  if (intruderResponse.status !== 403) {
    throw new Error(`Expected cross-user review run overwrite to be forbidden, got ${intruderResponse.status}.`);
  }

  const deleted = await deleteRun(saved.id);
  const deletedRouteRun = await deleteRun(routeRun.id);
  await cleanupUsers();
  console.log(
    JSON.stringify(
      {
        savedRunId: saved.id,
        loadedChecks: loaded.checks.length,
        signoffStatus: check.signoffStatus,
        routeSignoffStatus: routeRun.checks[0].signoffStatus,
        crossUserOverwrite: 'forbidden',
        deleted: deleted + deletedRouteRun,
      },
      null,
      2,
    ),
  );
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  await cleanupUsers().catch(() => undefined);
  process.exitCode = 1;
});
