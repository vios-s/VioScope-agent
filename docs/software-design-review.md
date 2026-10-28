# Software design review

Date: 2026-08-18
Reviewed on: `dev`; release target: `main`
Reference: [A Philosophy of Software Design, Second Edition (Chinese translation)](https://yingang.github.io/aposd2e-zh/)

## Review standard

The review treats complexity as change amplification, cognitive load, and unknown unknowns. It favors deep modules, information hiding, explicit trust boundaries, consistent conventions, and small continuous design investments. File or function length alone is not considered a defect.

## Findings

| Priority | Status | Evidence | Design response |
| --- | --- | --- | --- |
| P1 | Fixed | `check:projects` depended on June 2026 fixture dates and failed once the 14-day planning window moved past them. | The integration check now derives lifecycle dates from the current UTC day, keeping the production clock behavior while making the check repeatable. |
| P1 | Fixed | Both project create and update routes duplicated the same request parser. TODO `done` used `Boolean(value)`, so the invalid string `"false"` became `true`. | `src/mastra/projects/input.ts` is the single write-boundary parser. It rejects ambiguous boolean and username-list values before business logic runs. |
| P1 | Fixed | Live chat and memory checks hardcoded stable port 3000, which prevented isolated test-port validation and could target the wrong deployment. | Both checks now use `VIOSCOPE_BASE_URL`; `.env.example` documents the boundary. |
| P2 | Fixed | 33 API route files implemented the same error JSON serializer and repeated `AuthError` status selection at each call site. | `src/mastra/http/error-response.ts` owns the response shape and authentication-status rule. Routes provide only the context-specific fallback status. |
| P2 | Fixed | The shared Playwright helper sampled welcome-dialog visibility before asynchronous session loading opened it, so the dialog intermittently blocked later clicks. | The helper now waits briefly for the dialog and closes it through its accessible control. Project and theme-meeting UI checks pass through the shared path. |
| P2 | Open | `app/operations-console.tsx` is 8,559 lines; its largest components are `UsersView` (1,021), `ProjectDetailModal` (856), `ThemeMeetingPanel` (546), and `ChatView` (544). | Extract by domain only when the extracted module can hide state or protocol knowledge. Splitting solely to shorten the file would create shallow modules and more navigation. |
| P2 | Fixed | `operations-console.tsx` and `review-form.tsx` contained 55 `fetch` calls and 54 local JSON parses with repeated fallback-error handling. | `app/client-request.ts` now owns network failure normalization, JSON parsing, API error extraction, and HTTP status metadata. All JSON workflows use its single interface; only best-effort logout keeps a direct `fetch`. |
| P3 | Accepted | Database modules such as `projects.ts` and `users.ts` are large. | They currently expose comparatively narrow domain APIs and hide SQL/schema details. Decompose only when a concrete change crosses unrelated responsibilities or tests show excessive coupling. |

## Design alternatives considered

1. Split the large React console immediately. This reduces file size but does not by itself reduce knowledge required for a change, and it creates a broad UI regression surface.
2. Add a generic validation framework. Zod is already installed, but converting every boundary would be a large migration with little immediate product value.
3. Consolidate the two demonstrated sources of change amplification and strengthen the existing integration check. This was selected because it removes duplicated policy, fixes observable behavior, and stays inside the current project-management/theme-meeting roadmap.

## Review gate for future changes

- Identify the information or policy the module hides; do not add pass-through wrappers.
- Keep validation at external boundaries and reject ambiguous values instead of coercing them.
- Put each cross-route policy in one place, with context-specific choices left to the caller.
- Make time-window checks relative to an explicit clock or to the test run date.
- Require one focused runnable check for each non-trivial branch or parser change.
- Prefer deleting duplicated knowledge over introducing a new abstraction layer.

## Verification

The reviewed change set passes TypeScript checking, the production Next.js build, the focused client-request check, the local API regression checks, and the Project, Theme Meeting, and Release Playwright checks. The final production build is running from the `dev` worktree on port 9999: HTTP readiness, unauthenticated API handling, live chat with cited sources, session memory, personal-memory isolation, and shared-chat memory boundaries all pass against that deployed instance.


## Deployment readiness audit — 2026-10-28

**Original audit decision (superseded by the remediation below): do not deploy the candidate yet.** Functional checks
pass, and Idea Pitch advice is suitable for supervised internal evaluation, but security blockers
remain. No deployment, dependency upgrade, production record change or external email was performed.
This review concerns the current working tree, including uncommitted theme-meeting and pitch work,
not just the previous committed release. It is a scoped engineering audit, not a penetration test.

### Release blockers

| Priority | Finding | Evidence and required action |
| --- | --- | --- |
| P1 | Password changes do not revoke existing sessions. | `src/mastra/auth/session.ts:91` verifies the signature and expiry, then loads the user without comparing the token with password-change/session-revocation state. A disposable-account test changed its password and successfully reused the old token. Bind sessions to a revocable credential version and test ordinary changes, password recovery and administrator resets before release. |
| P1 | Known vulnerabilities remain in the production dependency graph. | `npm audit --omit=dev --json` reported 27 affected package entries: 2 critical, 16 high, 5 moderate and 4 low. Direct packages include Next.js 16.2.9, Zod 4.4.3, fast-xml-parser 5.9.3 and Nodemailer 9.0.1. Upgrade in an isolated dependency installation, triage remaining reachability and rerun build/regression before replacing the live release. These counts are package advisories, not 27 demonstrated exploits. |
| P2 | No application login-attempt throttle was found. | The login route calls password verification for every request. Perimeter rate limiting was not verified in this audit. Verify an effective limit or add a tested application limit before broad exposure. |

Relevant advisory references:
- [Next.js image optimization advisory](https://github.com/advisories/GHSA-2xp9-vwfh-vxw4).
- [Zod resource consumption advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5).
- [fast-xml-parser entity expansion advisory](https://github.com/advisories/GHSA-8r6m-32jq-jx6q).

Reachability matters: the reviewed app does not use authorization middleware as its sole permission
boundary; permission checks live in API/domain code. Some dependency findings concern optional or
platform-specific paths, so the audit counts alone do not establish exploitability. However, uploaded
PPTX files do reach the installed XML parser, and API inputs reach Zod. Those paths need remediation
or demonstrated mitigation, rather than blanket dismissal of transitive dependency findings.

### AI quality and English policy

Six synthetic cases were sent to the configured ELM model: empty input, universal/unsupported claims,
a bounded experimental pilot, proof-oriented research with a negative example, Chinese prompt
injection, and contaminated evaluation with unauthorized patient-data access. Full outputs were read
for relevance and concrete next steps, in addition to schema and exact-quote checks.

The first run produced an invalid JSON response for the Chinese case. Idea review now uses the
installed AI SDK's `Output.object` schema boundary, followed by existing semantic/evidence checks.
Rules now request short assessments and at most three prioritized next steps. The final six-case
run passed: it rejected unsupported claims, identified test leakage, proposed proof obligations for
theory work, and did not treat student instructions as approval authority. A coherent pilot received
`ready_for_discussion`; this remains advice and does not approve or create a project.

All system-owned UI and AI explanations use formal English, including when input is Chinese. The
policy is shared by chat, project artifact summaries and pre-submission reviews. Original user text
and exact evidence quotations are preserved. Idea Pitch prohibits Chinese characters in generated
summary/assessment/improvement/next-step fields, while allowing them in evidence quotations.
`check:english-policy` verifies source content, shared prompts and this validation boundary.

Limitations: six synthetic cases are not a calibrated scientific benchmark. Recommendation labels
varied between reasonable categories across runs, and some advice was conservative about readiness
for discussion. The model does not verify novelty or literature and may still be wrong. A PI-reviewed
set of real, consented or anonymized proposals is needed before relying on it for consistent grading.
Chat and B2 share the English prompt policy but were not newly evaluated against live multilingual
adversarial inputs in this audit.

### Verification and maintainability

- Nineteen isolated regression groups passed: client requests, user datastore, idea import, audit
  coverage, account management, projects, project artifacts, B2 review runs, admin configuration,
  release hardening, theme meetings/auth/preview/subscriptions/project advice/workflow, chat sharing,
  database/access hardening and Idea Pitch.
- Earlier failures from missing clean-database schema and a missing temporary fixture directory
  were corrected in the audit harness, not classified as product regressions. The subscription test
  now supplies a fixed pre-cutoff clock so it tests membership instead of the current date.
- The final candidate browser regression passed: editing/conflict protection, sharing/revocation,
  administrator/collaborator access, four export formats and desktop/tablet/mobile layouts. Screenshots
  are in `.local/checks/audit-final-ui`.
- The candidate production build and TypeScript checks passed. The pre-existing broad file-tracing
  warning from `submission/draft.ts` remains; inspect the packaged artifact before a portable release.
- A heuristic scan of 214 tracked/untracked, non-ignored text files found only two documented example
  credential placeholders. This does not scan Git history, binary files or ignored internal data.
- The previous pitch review removed the sharing/version overwrite risk and the unnecessary project
  refresh coupling. Account-directory ownership is now independent of chat. Full history is fetched
  only when needed. The 8,773-line operations console remains a maintenance concern; extract cohesive
  domains incrementally rather than splitting solely by line count.

Local evidence (ignored, synthetic data): `.local/checks/repository-audit/npm-audit.json`,
`.local/checks/repository-audit/session-revocation.json`,
`.local/checks/repository-audit-recheck/results.json`,
`.local/checks/idea-quality-english-final/results.json`, and
`.local/checks/repository-audit/secret-scan.json`.

Next release order: fix session revocation; upgrade/triage vulnerable dependencies in isolation;
verify login throttling and request-size limits; rerun the release checks; verify backups and rollback;
then deploy. Production backup restoration, sustained load, perimeter configuration and exhaustive
wiki-answer quality were not verified here.


## Security remediation — 2026-10-28

The two P1 findings above have been addressed in the source and isolated release candidate. The
running service has not been changed. Deployment still requires installing the new locked dependencies
with the matching build; the old live `node_modules` must not be mixed with this candidate.

### Session revocation

`users.session_version` is an additive integer column with a default of zero. Signed cookies carry
that version, and every authenticated request compares it with the current active account. Password
changes, administrator resets, consumed recovery credentials, CLI password replacement, forced-reset
changes and disable/re-enable transitions invalidate previous cookies. Ordinary profile edits and
an unauthenticated password-reset request alone do not invalidate them.

Credential-changing writes increment the version atomically. Login, password-change and administrator
updates check the version they originally read, so concurrent operations cannot restore an older
password or mint a fresh session using superseded credentials. Administrator and CLI password
replacement also clear older recovery credentials. The password-change response issues a new cookie.

Cookies without a version are rejected: **all users must log in once after deployment**. No timestamp
rounding or same-second exception is used. The schema addition is retained on rollback. If reverting
to pre-fix authentication code, rotate the session-signing secret or keep the fixed auth module;
otherwise that old code could accept previously revoked cookies again.

`check:session-revocation` covers profile edits, same-operation cookie renewal, ordinary and repeated
administrator resets, recovery consumption, superseded recovery codes, disable/re-enable, CLI updates,
concurrent password changes and legacy-cookie rejection in a disposable database. The existing account
check now logs out with the renewed cookie and explicitly verifies that the old cookie returns 401.

### Dependency remediation

A separate installation was used at `.local/release-security-20261028`; no dependency installation
scripts or modifications to the running service's dependency directory were performed. Compatible
security updates were applied, then Nodemailer was explicitly upgraded across its major boundary.
Direct vulnerable dependency minimums and the lockfile were updated together.

Key resolved versions: Next.js 16.4.3, Zod 4.6.7, fast-xml-parser 5.11.2, Nodemailer 10.2.1,
AI SDK 6.0.317, OpenAI provider 3.0.134, Mastra core 1.80.0 and Mastra memory 1.39.1.

The new `npm audit --omit=dev` result is **zero known vulnerabilities**. Full development audit retains
four low-severity package entries for one advisory chain:
`mastra -> @mastra/deployer -> @rollup/plugin-node-resolve -> deepmerge`.
The [deepmerge advisory](https://github.com/advisories/GHSA-gcqx-w48m-w2h4) has no patched upstream
release. The installed node-resolve implementation calls it when copying its static default options;
it is not in the production dependency graph. This residual build-tool risk is documented rather than
forcing npm's suggested incompatible downgrade to an old Mastra release. Use trusted build inputs and
revisit when upstream provides a fix. No claim is made that the complete development graph is clean.

### Verification

- Production build and TypeScript passed against the independent upgraded installation.
- All 21 selected regression groups passed, with account management rechecked after correcting its
  old-cookie logout assumption; original and recheck receipts are both retained.
- Browser checks passed for private/admin/shared pitch access, concurrent edit conflicts, sharing
  revocation, deletion, four download formats and desktop/tablet/mobile layouts.
- Six live synthetic ELM evaluations passed against the upgraded AI SDK, including English advice
  for Chinese input and injection resistance; reports are in `.local/checks/security-ai/`.
- New `check:email-transport` passed through the real Nodemailer transport to an in-process loopback
  SMTP receiver, verifying plain text, HTML and the recipient envelope. No external mail was sent.
- Production and full dependency audit reports are in `.local/checks/security-dependencies/`.
  Regression receipts are in `.local/checks/security-regression/` and
  `.local/checks/security-account-recheck/`; browser evidence is in `.local/checks/security-ui/`.

These changes resolve the two identified blockers; they do not establish that perimeter throttling,
backup restoration or sustained load have been verified. The English-only product policy remains in
force. The isolated candidate is ready for the remaining operational release checks, not automatically
promoted to the running service.


## Deployment — 2026-10-28

The tested Idea Pitch/security candidate was deployed to the stable web service. Both the application
build and its independent upgraded dependency installation were switched together. The additive
session-version migration completed. A pre-deployment database dump was successfully restored to a
disposable database (23 public tables) before promotion. The previous build and dependencies remain
available for controlled rollback; the session-secret rollback requirement above still applies.

Public HTTPS smoke checks passed: home/login on desktop and mobile, the new Checklists Idea Pitch
bundle, protected API 401 responses, removal of the legacy pitch route and zero browser script errors.
Users must sign in again once. No synthetic pitch records were inserted into the production database.
Main and dev are synchronized to the release containing this note. Existing uncommitted dev work was
preserved separately as a local Git stash and is not part of this release.

Host-local deployment, backup and preserved-work receipts live under `.local/`; they are excluded
from Git. Do not remove the active release dependency directory while it is referenced by the web
service. Production dependency audit remains clean; the documented development-only low-risk
advisory chain remains unchanged.
