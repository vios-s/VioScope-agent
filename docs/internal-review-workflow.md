# Internal review and submission readiness

Internal Review is a project-bound workflow in Checklists, alongside Idea Pitch and Skeleton Lock. Project Details → Checkpoints contains only checkpoint recording and history; recorded checkpoints follow the decision form. It uses one canonical set of project tasks. Human reviews and decisions are independent of advisory AI checks.

## Roles and visibility

- Only the exact project owner may submit a versioned manuscript or start another round (including when other users hold PI/admin roles). The Internal Review evidence-entry and submission forms are visible only to the owner. The owner reads all submitted reviews, responds to each review and completes revisions. Owners cannot review or approve their own project, including owners with PI/admin roles.
- The project's assigned active PDRA is the required reviewer. Active collaborators and independent PI/admin accounts may submit optional reviews. An owner, PI/admin or assigned PDRA may invite another active account only if it already has project access. Invitations grant no project access.
- Each reviewer edits only their own private draft. Neither the owner nor PI/admin can read another reviewer's unsubmitted draft. Submitted review versions are retained and visible to current project readers.
- Only the assigned PDRA classifies review requests and accepts or returns completed revisions. Only an independent PI/admin grants final submission clearance. Optional reviewers who have not submitted do not block readiness.
- Username identity and current project access apply to every operation and notification read. Changing project context, personnel, research version or submission attempt requires a new review round.

## Manuscripts and review rounds

Create a submission plan and assign the lead PDRA. The owner can use **Upload a manuscript PDF** directly in Internal Review: choose a text-based PDF up to 5 MB, name its version and confirm **Upload PDF and start review**. The server validates readable text (up to 200,000 characters), stores the immutable file in the existing project material store, registers completed document evidence and creates the new review round in one database transaction. The manuscript link downloads the same project material. Stale or unauthorized submissions roll back the material/evidence/round records and remove the new file. Alternatively, register existing document evidence for the manuscript. Evidence references an existing project material version or an explicitly versioned source URL. Project Update remains an optional upload route; it is no longer required for manuscript submission. A source URL must identify the intended document version; the application does not snapshot external websites.

Submitting a manuscript explicitly creates a round and starts the required PDRA's 48-hour review window. A new manuscript round preserves previous reviews and tasks. Existing required tasks must still receive PDRA acceptance or be explicitly retired by the current PDRA with a reason; starting a new round does not silently cancel them. Earlier rounds remain available for reading.

Reviewers complete the eleven evidence-based checklist items, summary, likely rating, confidence, strengths, weaknesses, optional checkmate questions and requested revisions. Submitting a correction appends a review version. The draft itself is never treated as an approval.

## Checklist layout

Internal Review uses the same project list, document-style record, numbered sections, underline navigation and workflow sidebar as Idea Pitch and Skeleton Lock. Search projects by title or owner; the project picker collapses on smaller screens. Reviewer status and required/optional roles appear in the sidebar, which scrolls with the page rather than inside a separate scroll area. Internal Review is opened from its standalone Checklists tab. Final PI clearance remains the last section of the Revision Tracker.

## Revision Tracker

The PDRA classifies each requested revision as Required, Suggested or Declined, with a reason. Conflicting advice is resolved explicitly. Required and Suggested items create `project_tasks` records; the project Tasks view and Revision Tracker show the same IDs, progress, evidence and history. Historical review versions remain classifiable so superseded requirements can be explicitly retired.

Owners and assignees can update progress. Completing a revision requires completed evidence. Completion is distinct from PDRA acceptance. Reopening or editing a task invalidates its earlier acceptance. Owners cannot downgrade or cancel review requirements. A PDRA changes their classification in the Tracker instead.

Revision Lock requires the assigned PDRA's submitted review, a disposition for every item in every latest submitted review, accepted completed evidence for all Required revisions, and no unfinished high-priority project tasks. Suggested revisions do not block the lock. The PDRA identifies the final manuscript evidence and explicitly confirms the lock.

Final PI clearance appears at the bottom of the Tracker after the current lock passes. An assigned PI other than the owner, or an independent administrator, records Approve submission or Emergency deferral, with evidence assessment and explicit confirmation. This writes the canonical project checkpoint history. Generic checkpoint forms cannot bypass Internal Review, Revision Lock or final clearance. Previous generic decisions remain readable.

Published review changes, requirement changes and relevant task changes invalidate the current lock and clearance; old decisions remain historical. Private optional drafts and owner responses do not invalidate a pass. No deadline automatically approves a checkpoint, advances a project stage or submits a paper.

Required tasks from a superseded review version remain blocking, even within the same manuscript round. Marking them Done does not replace PDRA verification. The lead PDRA can explicitly retire a superseded requirement with a recorded reason; the owner cannot retire it. Removing a finding from a newer review never silently removes its task or approval requirement.

The original manuscript, final manuscript and required revision evidence must still reference completed evidence and available project materials. Removing a referenced material directly or deleting its project update invalidates Revision Lock and final PI clearance. Internal Review, project checkpoint history and reminders use the same check; historical decisions remain recorded. Material removal and approval writes serialize on the project row. External source URLs remain recorded declarations rather than availability checks of remote websites.

## T-minus reminders

The submission plan stores an exact UTC deadline and an IANA display timezone. Milestones subtract elapsed days from that instant; reminders display the plan's timezone, including daylight-saving rules.

| Milestone | Audience | Outstanding action |
| --- | --- | --- |
| T−42 days | Owner and assigned PDRA | Skeleton Lock assessment |
| T−35 days | Owner | Code Lock confirmation |
| T−28 days | Owner | Submit a current manuscript review round |
| 48 hours after manuscript submission | Assigned PDRA | Return the required Meta-Review |
| T−14 days | Owner and assigned PDRA | Complete and verify revisions |
| T−48 hours | Assigned PI, or active admins when no PI is assigned | Final PI clearance; unresolved lock blockers remain visible |
| T−24 hours | Owner | Submit the approved manuscript and record the outcome |

These are web notifications in the bell's Messages view and Briefing; clicking opens Internal Review for the project. They follow the existing Project progress reminders web preference. A five-minute systemd user timer runs `scripts/submission-reminders.ts`, so generation does not require an open browser. The same timer also sends email using the existing SMTP settings and the independent Project progress reminders email preference. Disabling web notifications or marking one read does not suppress email.

Notifications are deduplicated by recipient, submission attempt and milestone (plus round for the 48-hour review window). The scheduler reconciles resolved actions; reads also check current status and access. Retargeting, recorded submission outcomes, archival or current PI deferral resolve obsolete reminders. Reopening a requirement keeps its existing notification rather than sending one every tick. Read state is per account. A missed milestone remains an advisory overdue action until resolved or retargeted.

Email covers all T-minus milestones and the lead PDRA's 48-hour overdue review. Each recipient/submission/milestone (and review round where applicable) has a separate PostgreSQL delivery receipt. Successful deliveries are not resent, including when a requirement reopens. Failed delivery retries after 5, 10, 20, 40, 80, 160 and 320 minutes, then at most once every six hours while still actionable. A 15-minute claim lease prevents concurrent sends and permits recovery after interrupted jobs. Each attempt rechecks the active account, current project access, responsibility, email preference and unresolved action; completion, deferral, retargeting and archival suppress obsolete retries. Global email disablement and missing addresses do not consume delivery receipts. First enablement sends currently outstanding milestones, including overdue ones.

SMTP acceptance and the database receipt cannot be committed atomically. Retries reuse a stable Message-ID, but an ambiguous SMTP acknowledgement or a crash after acceptance can still produce a duplicate; receipt-based deduplication is not an exactly-once guarantee. The job logs sent/failed/skipped counts and exits unsuccessfully on delivery failures; the timer retries according to the persisted backoff. Emails include the configured `VIOSCOPE_BASE_URL` Checklists link when available, the project title, deadline/timezone and action. Select the named project in Internal Review.

## Operations and validation

Schema additions are `internal_review_rounds`, `submission_notifications` and `submission_email_deliveries`; tasks and decisions use existing stores. Project-row locks serialize review writes with project workflow changes. Optimistic revision checks reject stale forms. A fingerprint binds each lock/clearance to published reviews, dispositions and relevant task versions.

Run `npm run check:submission-emails` for disposable-database and loopback-SMTP delivery checks. Run `npm run check:internal-review` with a local PostgreSQL connection. It creates and destroys a disposable database. `UI_RUNTIME=/absolute/candidate npm run check:internal-review-ui` also exercises the compiled application with real synthetic accounts at desktop, tablet and mobile widths. `npm run check:project-workflow` covers existing project and meeting-task compatibility.

Build in a new isolated directory with independent dependencies. Back up and restore-verify PostgreSQL and preserve matching meeting sidecars before deployment. Render the service template with the application path, immutable release path and Node executable, then enable `vioscope-submission-reminders.timer` under the user service manager. Verify both the web service and timer after deployment.

Email-only rollback restores the previous reminder service and application together; retain the additive `submission_email_deliveries` table and receipts to prevent resends after re-enablement. No database restoration is required for this additive change.

Rollback of the original Internal Review release must stop the new timer and restore the previous application/dependencies. Keep new review data and tasks; older code cannot display the new review rounds or enforce their acceptance rules. Do not use the older UI to perform final approvals after rollback, and never restore an old database snapshot over newer user work without review.


## Multiple PDRAs and PIs

Projects accept multiple active PDRA accounts and multiple active PI/admin accounts. One PDRA is explicitly shown as the lead: only that account has the mandatory review, 48-hour review duty, requirement classification, revision acceptance and Revision Lock responsibilities. Other assigned PDRAs have project read access and may write their own optional review, just like collaborators; assignment does not grant project editing rights. Owners cannot be PDRAs for their own project.

Any assigned PI other than the owner may provide final submission clearance; one approval is sufficient. Independent administrators retain their override authority. An unassigned PI may retain existing lab-wide project access and optional reviewing rights, but cannot provide this project's final clearance. Skeleton Lock also accepts any assigned PI, retaining its separate-person and explicit administrator override rules.

The final-clearance reminder goes to every assigned PI except the owner, with per-account read state and deduplication. One valid clearance resolves it for everyone. Additional PDRAs do not receive the lead's mandatory reminders.

Add/Edit project provides Project PIs and Project PDRAs multi-selects plus a Lead PDRA selector. Idea Pitch conversion accepts comma-separated PI and additional-PDRA usernames. Legacy scalar assignments are preserved in compatible columns; single-person saved snapshots retain their original shape. Changing reviewer membership invalidates current checkpoint context and requires a fresh review round; saved decisions are never rewritten.

## Automatic AI Internal Red-Team

An explicit owner manuscript submission saves the new round first, then automatically runs the configured `vios-internal-red-team` skill through ELM. Opening the page never starts a paid model call. The owner, lead PDRA and responsible PI/admin may explicitly retry or generate a fresh report for the current round. Collaborators and other project readers can read saved reports. AI cannot publish a human review, classify revisions, create tasks or approve a checkpoint.

New reports combine the strict Red-Team critique with the VIOS Internal Meta-Review Template: a three-sentence Summary & Contribution; Likely Rating (1–10) and Confidence (1–5); three Primary Strengths; three Primary Weaknesses; two Checkmate Questions; and proposed Writing, Experiments and Visuals revisions for the next 14 days. A report without manuscript text has no score. Strengths, weaknesses and revision proposals require verified source quotes. The model request uses the Meta-Review JSON schema through structured output, followed by local schema and quote validation. Previously saved three-section Red-Team reports keep their original format and remain readable. It examines novelty, technical quality, experimental rigor and clarity. Advice is English; quoted evidence retains its original language. The saved record includes the model, applied skill/rule snapshot, timestamp, input snapshot and source fingerprint; earlier reports remain available. It is separate from human round revisions and never invalidates a human lock merely by being generated.

Input is assembled on the server from the current submission venue, research question/claim/validation/risks, project notes/target/blocker, completed evidence, current artifact summaries and the latest ten project updates. The selected manuscript attachment is read when it is a supported text-based PDF, DOCX, TXT, Markdown or LaTeX file of at most 5 MB. Abstract, Introduction and Results are taken from supplied manuscript text when available; project claims are never silently presented as manuscript sections. External URLs are references only, not fetched. If no readable manuscript is available, the report explicitly covers only recorded project evidence. Images and layout are not assessed. For PDFs with a strongly detected sequential margin-number column, the reading text removes those margin labels and records this in report limitations; the original PDF remains unchanged. Numerical results, references and ordinary short numbered lists are retained. Inputs above 240,000 characters are rejected rather than silently truncated.

Generation uses a bounded timeout, a per-round claim to prevent duplicate concurrent runs, and a second check of account access and source context before saving. A changed project/input or revoked access discards the generated output. Failures leave human workflow state intact and expose a retry action; interrupted runs can be retried after three minutes. Historical reports describe their saved input, not subsequent edits.


### Review tabs and PDF input

Reviews, Revision Tracker and AI Internal Red-Team are sibling tabs for every project reader, including PDRAs and PIs. Human reviews open by default; successful direct PDF submission opens the AI tab. Panels stay mounted while switching tabs so an unsaved human review is not discarded. Tab navigation supports arrow keys, Home and End. AI output remains read-only advice: its revision proposals require the lead PDRA's independent judgment and do not automatically create tasks.

Only the owner sees the direct-upload form. The uploaded PDF becomes the selected manuscript evidence for the newly created round, and AI reads that stored version automatically alongside current project context. Scanned or otherwise unreadable PDFs, including password-protected files that cannot be read, are rejected with an actionable error before any new round is created. PDF extraction covers text, not a visual inspection of figures. The upload does not make a second model call just to create a material digest. Duplicate concurrent uploads have separate temporary files; the round's expected previous ID prevents duplicate records.

Regression tests use disposable databases, synthetic manuscripts and simulated model responses. Private manuscripts, saved AI reports, role-switching demo gateways, credentials and local deployment receipts are not distributed with this repository.
