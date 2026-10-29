# VioScope Roadmap

This is the current product roadmap after the v0.1 stabilization pass. Keep this document short: it
should tell future work what to build next, what not to revisit, and what must be true before a release.

## Product Direction

VioScope is an internal lab operations console and advisory agent for VIOS workflows. It has three
layers:

- Data layer: account records, project state, artifacts, runtime config, and external lab materials.
- Capability layer: theme-meeting support, project planning, pre-submission review, and cited wiki Q&A.
- Delivery layer: Mastra/Next.js web UI with authenticated sessions, shared chat, and notifications.

The project remains generic open-source code. Site-specific data, skills, runtime state, uploads, and
private lab material stay outside this repository under `DATASTORE_DIR`, `/Public`, or internal repos.

## Locked Decisions

- Runtime stack: Mastra plus full-stack TypeScript.
- Primary deployment target: EIDF.
- Stable service: release/tagged build on port `3000`.
- Development service: separate branch or worktree on port `3030`.
- Default model provider: ELM through an OpenAI-compatible API.
- Project Manager Postgres records are the operational state source of truth.
- Theme meeting identity uses `users.username`; display names and self-editable aliases never grant
  project, meeting or review access. New review records store account usernames.
- Relational queries use one native PostgreSQL pool per database/process, capped at eight connections.
  Transactions pin one client and nested helpers join it; vector retrieval keeps its separate Mastra
  vector store. Shared datastore writers use transaction advisory locks and atomic file replacement;
  test teardown explicitly drains shared connections before dropping disposable databases.
- Theme meeting times use `Europe/London`.
- Agent output is advisory and evidence-backed; humans confirm writes and verdicts.

Do not restore `lab-state.yaml`, local lab fixtures, or public-code private content.

## v0.1 Baseline

The v0.1 package should be treated as the first stable internal operations build:

- Authenticated operations console with member, coordinator, PI, and admin roles.
- Project Manager DB records, progress updates, artifact upload/digest, comments, and planning scan.
- Theme meeting configuration, update submission, member management, reminders API, and role filters.
- Chat sessions, history, shared sessions through `@username`, alerts, and notification preferences.
- User memory files and public team profile cache under `DATASTORE_DIR`.
- Admin configuration, audit log, service restart hook, and backup scripts.
- B2 submission-review harness and B3 GitBook/wiki retrieval remain available, but are not the main
  development priority unless explicitly resumed.

## Next Development Phases

### Agreed Function Order (2026-10-28)

Implement these functions incrementally, reusing the existing project, meeting and review features.
Steps 1–3 are deployed. Development now uses main. At the user's request, the next slice reworks Skeleton Lock before the full submission timeline in step 4; later steps remain planned work.
This order takes precedence over the older phase numbering below. Keep B3 maintenance-only.

| Order | Function | User outcome | Status |
|---|---|---|---|
| 1 | Confirm theme meeting agendas | The coordinator adjusts order and time, defers items when needed, and confirms a saved agenda version. | Deployed 2026-10-28; real-cycle pilot pending |
| 2 | Follow up meeting actions | Record the decision, responsible person, due date and completion evidence; review unfinished actions at the next meeting. | Deployed 2026-10-28; real-cycle pilot pending |
| 3 | Review private idea pitches | Upload or fill a pitch; get configurable AI advice; humans decide; explicitly create a project inheriting only the final approved version. | Deployed 2026-10-28; synthetic tests passed |
| 4 | Build submission timelines | Count backwards from the submission date to the six-, five- and four-week checks and final two weeks. | Planned |
| 5 | Confirm stage readiness | Require evidence and a named reviewer at each checkpoint, beyond a progress percentage. | Planned |
| 6 | Complete internal review | Assign a PDRA, track feedback and required revisions, then obtain final PI clearance. Reuse the B2 harness. | Planned |
| 7 | Learn after submission | Record outcomes, reviews, lessons and the revision or resubmission plan. | Planned |
| 8 | Review the group portfolio | Extend the existing overview with submission risks, blockers, support needs and resource gaps. | Planned |
| 9 | Support quarterly and career reviews | Record research, collaboration and development reflections with separate access controls. | Planned |

#### Step 1 acceptance criteria

- Coordinators manage only their own theme; PIs/admin may manage all themes.
- Adjust agenda order and slot duration; show the 60-minute budget and explicitly defer items
  that do not fit. Deferral must remain visible, without automatically submitting a future update.
- Explicit confirmation saves the agenda snapshot, version, confirming username and time.
- Later submissions or edits never silently change a confirmed agenda; changing it requires a
  new explicit confirmation. Reject stale concurrent edits instead of overwriting them.
- Keep the existing two-theme weekly layout, slot types, member-only preview audience,
  subscription boundaries and Europe/London scheduling.

#### Step 2 acceptance criteria

- Record meeting decisions and actions against the specific theme and meeting date.
- Each action has an active account owner, due date and status; completion records a note/evidence.
- Show outstanding actions from earlier meetings for follow-up, with overdue dates visible.
- Coordinators/PI/admin create and manage actions; assigned members can update their own progress.
- Use account usernames for authorization and retain who changed each record and when.
- Human confirmation is required for decisions and actions; no automatic project or wiki writes,
  and no extra project access from action assignment or agenda subscriptions.

Done when: a real theme meeting can move from draft to confirmed agenda, recorded decisions,
assigned actions and next-meeting follow-up, with permission and concurrency checks passing.

Optional project links (deployed and tested 2026-10-28): new meeting decisions/actions
can select an existing accessible project, or remain unlinked group actions. The recorder and assignee
must already have project access. Linked records are visible in the project's details to its authorized
viewers; meeting reads and updates also enforce current project access. Both views read the same action
record, including completion history. Linking never grants access or changes project stages, progress or
todos. Existing actions remain unlinked. Real-cycle pilot deferred at the user's request.
Deployment validation used an isolated database and the production build: project selection, action
creation, member completion, project-side shared history, unchanged stage, and desktop/mobile layout
passed. Live HTTPS login, updated bundle and unauthenticated API guards also passed.

Implementation: each theme card exposes `Confirmed agenda and follow-up`, including a date selector
for previous meetings. Existing member-only visibility is preserved; managers see their theme's
records, while members see their own slots/actions. Deferral does not automatically book a later
meeting. Action notes and status changes retain their actor and timestamp. No action emails or
automatic project/wiki write-back are introduced.

Snapshots and action history are stored beside the external meeting updates file as
`<updates-path>.workflow.json`, using the existing database advisory locks and atomic file writes.
Include this sidecar in datastore backups. Validate with `npm run check:theme-workflow`.

Deployment check (2026-10-28): production web build passed; the built application passed a
synthetic-database browser flow for agenda confirmation, action assignment and member completion.
Live HTTPS login, new bundle delivery and unauthenticated API guards passed after service restart.
A real meeting pilot is still pending. The previous build is retained locally for rollback.

#### Step 3: Private idea pitches (revised by user)

- A pitch exists before a project. Use Checklists → Idea Pitch, which replaces the former template preview. The separate
  sidebar entry and previous project-details editor have been removed. All eight blocks are open on
  entry; upload and paste are also expanded. A working title is optional; saving uses the research
  question when it is blank. Opening the editor creates no record. Drafts, revisions, stop/revise/proceed decisions and AI advice alone
  never create a project or count as active projects.
- Title stays visible at the top of the form and can be revised with Save. Saved revisions include
  their title. A saved pitch has Delete pitch with explicit irreversible confirmation; owner/PI/admin only,
  stale versions rejected, revisions/source/reviews removed together. Converted pitches cannot be
  deleted. Switching pitches warns about unsaved changes and is blocked during pending requests.
- Full pitch history is visible only to its proposer, PI and administrator. The proposer/PI/admin may add explicit
  active account collaborators who can read only the current saved title, blocks and decision.
  Sharing exposes no original text, past revisions or AI reviews and grants no editing, export,
  onward-sharing or project access. Removal revokes subsequent reads. No notification is sent.
  PI and administrator have a searchable all-pitches list with proposer, version and status filters. Other users see
  separate My pitches and Shared with me groups. Role labels alone never grant shared access.
- Input: structured editable blocks, pasted complete text, or TXT/MD/DOCX/text-based PDF/PPTX upload.
  Uploads are capped at 5 MB and 32000 extracted characters; scanned pages/figures need transcription.
  Extraction produces exact source excerpts in a preview. Applying the preview replaces unsaved blocks;
  explicit Save persists the edited blocks and extracted source text. Original binaries are not retained.
- Eight areas: question, importance, contribution, reasoning/evidence, validation, resources/access,
  risks/alternatives and next milestone. Partial drafts are allowed; completeness is not quality approval.
- The editable `src/mastra/prompts/idea-pitch/SKILL.md` powers ELM assessment. An external
  `IDEA_PITCH_SKILL_PATH` overrides it and is reread for each request. Reports include exact input quotes,
  gaps and improvements, prioritized tests, model and rule fingerprint; full rule snapshots are stored.
  AI advice does not grant approval or replace a human decision. No live literature search is claimed.
- Human proceed/revise/stop decisions require explicit confirmation, reasons and a next/closure plan.
  Proceed needs complete fields. Revised drafts reset the decision to pending; immutable prior versions
  and advisory reviews remain private. Stale concurrent writes/reviews are rejected.
- After Proceed, offer a private approved-document download in DOCX/PDF/Markdown/TXT. Default to
  the supported source format, otherwise DOCX. Export the current confirmed title, eight blocks and
  decision metadata only; never source text, old drafts or review history. Reject stale/unapproved
  versions. A clean layout replaces original upload formatting. PDF requires Playwright Chromium.
- After Proceed, a separate explicit Create project action creates exactly one Stage 1 project.
  It inherits only the final draft and confirming decision as a read-only starting snapshot; project
  viewers never inherit old drafts, source documents or AI review history. Converted pitches are read-only.
- Storage: `idea_pitches`, `idea_pitch_revisions`, `idea_pitch_reviews`, `project_idea_origins` in Postgres.
  The owner, PI and administrator can inspect all stored revisions and advisory reviews.
- Rule configuration and methodology: [idea-pitch.md](idea-pitch.md).
- Deployment verified 2026-10-28: live HTTPS serves the private pitch bundle, the old project
  idea-check route returns 404, and unauthenticated pitch/project-origin requests return 401.
  The previous build is retained for rollback; no real student records were used in validation.
- Checklists replacement deployed 2026-10-28: default expanded input, optional title, old `?view=ideas`
  compatibility, save/reopen/new-pitch switching and other checklist tabs passed isolated browser checks.
  Desktop/tablet/mobile and public HTTPS smoke passed. Taste-skill checks passed with the existing
  site palette and outer shell retained. A live ELM run passed; one repeat returned malformed JSON,
  which leaves saved content intact and offers retry.
- Title/delete/export update deployed 2026-10-28. A synthetic cell-counting pitch passed title
  revision/reload, cancelled unsaved switching, deletion cancellation/confirmation, owner/PI/admin checks,
  stale-version rejection, Proceed and all four browser downloads. Word/PDF files were rendered and
  visually checked; the sample is one page in both. Live HTTPS bundle and unauthenticated export
  protection passed. No real pitch was created, changed or deleted during these checks.
- PI overview/read-only sharing deployed 2026-10-28. Synthetic owner, PI and collaborator accounts
  passed add/read/revoke, private history/source/review exclusion, no onward sharing or mutations,
  PI list/open and phone layout checks. Existing title/delete/export flows passed again. Live HTTPS
  and unauthenticated collaborator mutation checks passed. No real sharing assignments were changed.
- Administrator permission correction deployed 2026-10-28: administrators have every PI pitch
  permission without explicit sharing. The overview is labelled PI / Admin. Synthetic tests cover
  all-history/source access, editing, decisions, stored AI reviews, sharing, export, deletion and
  conversion, while preserving ordinary collaborator restrictions. Admin browser and live HTTPS
  checks passed; no real pitch records were modified for validation.
- Validate with `npm run check:idea-check`, `npm run check:idea-import`, audit coverage, production build
  and an isolated browser flow. Live ELM tests use synthetic pitches only.

### Phase 1: Release Hygiene

- Commit a clean v0.1 release candidate and tag it.
- Run the stable service from that tag on port `3000`.
- Use a separate worktree or clone for dev branch work on port `3030`.
- Keep stable and dev `.env`, upload roots, and writable runtime state separate unless a path is
  intentionally read-only.
- Document the exact systemd/user service commands used on EIDF.

Done when: `3000` serves the tagged build, `3030` serves the dev branch, and rollback means switching
the stable service back to the previous tag.

### Phase 2: Theme Meeting Automation

- Finish scheduled browser/web reminders for first reminder, missing-only reminder, and cutoff.
- Send a Tuesday 13:00 Europe/London draft agenda preview only to the active theme's members.
  Label it provisional, show deep dives and outstanding submissions, and keep updates editable until
  Wednesday 08:00. Keep preview/final delivery receipts separate; only the cutoff circulation includes
  additional PIs/admin and subscribers, scoped by theme and respecting email preferences.
- Generate cutoff agendas from submitted updates and mark missing updates as `not_submitted`.
- Add coordinator/PI/admin agenda confirmation.
- Agenda subscriptions are separate from membership: controls live in the upper right of each
  current-week theme card. Members/coordinators and configured PIs/admin are automatically subscribed;
  other active accounts may opt in/out without submission duties or project access. Agenda emails
  include only the recipient's themes, with all active themes included for PIs/admin.
- Keep the weekly two-card layout and Europe/London scheduling; production agenda cutoff is Wednesday
  08:00. Respect email preferences and per-recipient delivery deduplication.
- Keep email delivery optional until browser notification flow is reliable.

Done when: a real weekly cycle can run without developer intervention.

### Phase 3: Project Signal Quality

- Improve project freshness signals from progress updates, artifact changes, and watch paths.
- Make planning recommendations easier to inspect and override.
- Show project-based meeting slot advice with recorded evidence and preparation prompts in Projects
  and the member meeting form. Blockers, requests for input, recent milestones, stage progress and
  deadlines inform the suggestion; ordinary recent progress suggests a 5-minute short update.
  Missing/stale progress never implies `nothing_to_report`. Adopting advice only changes the draft;
  members submit explicitly and coordinators confirm the final agenda.
- Keep artifact summaries as context; do not inject raw large files into agent prompts.
- Add focused checks for permission boundaries around artifacts and project updates.

Done when: PI/admin planning brief is useful enough for weekly review and members can maintain their
own project state with minimal friction.

### Phase 4: Collaboration And Memory

- Polish shared chat click-through from Alerts and shared-session discovery.
- Keep personal memory private to the signed-in user.
- Add export/import or reset tools for user memory only if real users need them.
- Avoid group-wide memory until role and audit rules are clear.

Done when: `@username` collaboration is useful without granting hidden data permissions.

### Phase 5: Wiki Q&A Evaluation

- Build a small eval set of real questions, expected source pages, and refusal cases.
- Tune dense retrieval threshold before adding hybrid retrieval or reranking.
- Keep Confluence, GraphRAG, and agentic retrieval out until the eval set shows dense GitBook retrieval
  is not enough.

Done when: supported questions cite the right sources and unsupported questions refuse cleanly.

### Phase 6: Pre-Submission Review

- Keep the B2 harness advisory.
- Tighten evidence display, run history, and signoff flow.
- Add Overleaf or richer document import only after the text/PPTX path is boring and reliable.

Done when: a draft review gives a useful verdict suggestion with evidence and a human signoff trail.

## Release Checklist

Before tagging a stable release:

- `npm run typecheck`
- `npm run web:build`
- `npm run build`
- `npm run check:users`
- `npm run check:account-management`
- `npm run check:projects`
- `npm run check:project-artifacts`
- `npm run check:theme-meetings`
- `npm run check:theme-meeting-auth`
- `npm run check:theme-workflow`
- `npm run check:idea-check`
- `npm run check:idea-import`
- `npm run check:review-runs`
- `npm run check:chat-collaboration`
- `npm run check:audit-coverage`
- `npm run check:release-hardening`
- Playwright smoke for project UI, theme meeting UI, and release UI
- `git diff --check`
- Confirm no secrets or private lab content are staged.

Run ELM/GitBook/wiki checks when those external services are part of the release scope.

## Backlog

- Public IP/TLS exposure.
- Email reminders through institutional SMTP.
- Confluence ingestion.
- Hybrid retrieval/reranking.
- Local EIDF model for sensitive content.
- Overleaf import.
- Fine-grained evaluation dashboards.


### 2026-10-28 release review

The candidate passes functional checks but is not cleared for a new stable deployment until session
revocation and dependency security findings are addressed. See `docs/software-design-review.md` for
the scoped audit, AI quality evidence and release gates. Product UI and generated advice use formal
English; user-authored text and verbatim evidence are preserved. Idea Pitch uses schema-constrained
review output with evidence validation; it remains advisory and requires a human decision.


### 2026-10-28 security remediation follow-up

Both P1 release blockers now have tested fixes in the candidate: versioned session revocation and
production dependency upgrades with zero known production advisories. The live service remains on
its existing release until deployment. Deployment requires the new lockfile and build together, and
all users must log in again once. Four low-severity development-only advisory entries remain on one
unpatched deepmerge build-tool chain; see the remediation section of the software design review.


### 2026-10-28 Idea Pitch release deployed

The checked Idea Pitch, English advice policy and session/dependency security fixes are now deployed.
The web service passed public HTTPS smoke checks after a verified database backup. Main and dev are
synchronized to this release; unfinished dev work is preserved in a separate local stash. Existing
users must sign in again. The editable Idea Pitch rules remain in the configured skill file.


### 2026-10-28 — Approved project / theme meeting handoff (deployed)

- Approved pitch conversion: carry the agreed milestone into the project target; record a first owner-responsible action and deadline in the existing project TODO list.
- Theme meeting submission: optionally attach an owned active project's owner, open next actions and deadlines. Existing projects are supported. A member must still submit explicitly; human agenda confirmation remains separate.
- Keep live tasks in Projects and historical snapshots in meeting records. Shared snapshots do not reveal private pitch versions or expand project permissions.
- Validation: disposable database integration, existing theme workflow/advice checks, English policy, production build and synthetic desktop/mobile browser flow. Deployed with the Skeleton Lock release below.


### Skeleton Lock rework — deployed

- Checklists → Skeleton Lock opens a dedicated single-check view, without the old template preview or an unrelated Run All action.
- Default input is eight expanded evidence sections matching the configured VIOS Skeleton Lock skill. Users may instead paste a complete outline or upload an existing supported draft/deck (TXT, Markdown, LaTeX, RST, PPTX). Input modes are exclusive; hidden material is never silently sent.
- Reuse the existing review run storage, access checks, Markdown/JSON downloads and PI/admin sign-off. Saved block-based reviews retain their input sections for reopening. Upload/paste reviews retain the existing report-only history behavior.
- Changing evidence or context clears the previous local review/sign-off and starts a new review. Mixed-check historical runs stay in the B2 workbench to avoid discarding other checks.
- AI results remain advisory. This slice does not add automatic stage changes, a project-linked readiness gate or the complete submission timeline.
- Rules remain editable in the external `vios-skeleton-lock/SKILL.md` loaded through `VIOS_SKILLS_DIR` (or the datastore skill directories). No private lab rule text is copied into public code.
- Verification: `scripts/check-skeleton.ts`; the original disposable-database browser runner (superseded by `check:skeleton-project` below). Browser AI responses are stubbed; persistence and account permissions use the actual routes. Deployment is separate.


Skeleton Lock live-AI validation (2026-10-28): a fictional cell-segmentation outline was reviewed by the configured ELM model using the configured Skeleton Lock skill. The result was SLIDE, with nine findings and ten draft citations; all citations were within the supplied text and were manually checked against the evidence. The review distinguished proposed experiments from completed results and retained pending human sign-off. Run `npm run check:skeleton-quality` to repeat this synthetic live-model check. One passing case is a smoke test, not a comprehensive model evaluation.


Skeleton Lock deployment verified (2026-10-28): main was pushed and runtime commit `69cc5f6` was deployed as build `henMjh3TcAIVve2veXl8F`. A temporary synthetic member used the public HTTPS website to run the configured real AI, save the review, and inspect pending human sign-off. The online review returned SLIDE with eight evidence-linked findings. Authentication guards, desktop/mobile layout and absence of client errors passed. The temporary account and review were removed after screenshots; the audit trail was retained. The previous runtime and a restore-verified database backup are retained in the local deployment receipt. This release also includes the approved-project/theme-meeting handoff.


### Project-bound Skeleton Lock — implemented, not deployed (2026-10-29)

- Every new Skeleton Lock check selects an existing active project. Owner, PI, PDRA reviewer, collaborators, target venue and submission deadline come from Projects. There is no separate initiator field.
- Projects now store an assigned PI and one PDRA reviewer using active account usernames. The PI must have PI/admin permissions. A project owner cannot be their own PDRA. Assigned PDRA accounts can read the project, but cannot edit it merely through this assignment.
- The owner, PI or administrator requests the AI check. The server attaches current project data and saves the evidence, AI result and project snapshot together. Legacy generic review records remain available in the review workbench; they are not automatically linked by title.
- The assigned PDRA has a dedicated review view and records Locked, Conditional or Revise with an evidence note. PI/admin has a separate overview and records final approval or required revision after the PDRA judgment. Administrators can perform either action. Human identities, timestamps and all previous judgments are retained.
- Only the newest AI check with unchanged project context can receive judgments. New checks require new judgments; amending a PDRA judgment requires fresh PI confirmation. Reassigning the PDRA immediately removes the former reviewer's assignment-based access. Project stages do not advance automatically.
- Validation: `npm run check:skeleton-project` uses a disposable database; `CHECK_SKELETON_PROJECT_UI=true` adds the owner/PDRA/PI browser flow against a separate production build. AI output in this workflow test is synthetic; live-model quality remains covered separately by `check:skeleton-quality`.
