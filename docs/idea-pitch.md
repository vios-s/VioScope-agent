# Idea pitch rules and input

Idea pitches are private pre-project proposals. The proposer, PI and administrator accounts have full access. Explicitly added collaborators can read only the latest saved pitch and decision.
Checklists → Idea Pitch supports structured blocks, complete pasted text and document uploads.
All input blocks are open by default. A title is optional; the research question names the pitch when
first saved. The optional title is at the top of the writing form and remains editable until conversion.
Saving records the title with that revision; older stored revisions may predate title snapshots.
Opening a new blank editor does not create a database record.
Create project is a separate human-confirmed step after a Proceed decision. Project viewers inherit
only the final approved blocks and decision, not prior versions, source documents or review history.

## Edit the review rules

Default skill: `src/mastra/prompts/idea-pitch/SKILL.md`.
It defines eight review areas, recommendation meanings, constructive feedback and research-type
adaptations. Edit its wording to adjust the group's expectations. It is loaded for every AI review
and import organization request. Existing reports keep their original rule snapshot and fingerprint.

For deployment, copy the generic skill into an external configuration directory, for example
`$DATASTORE_DIR/skills/idea-pitch/SKILL.md`, and set `IDEA_PITCH_SKILL_PATH` to its absolute path.
Restart the service once after changing the environment setting. Later edits to that external file
apply to the next request without rebuilding or restarting. Keep private lab-specific wording outside
this public repository. An unreadable, blank or oversized configured file causes an explicit error;
there is no silent fallback to different rules.

Code enforces the output structure and permission boundaries independently of the editable prose.
The report must cover all eight fields, quote actual input substrings and distinguish recorded facts,
inferences and gaps. Recommendations are `ready_for_discussion`, `needs_revision` or
`insufficient_evidence`, never automatic approval. No numerical score or independent literature
verification is implied. A rule change should be checked on representative pitches before adoption.

## Input and extraction

TXT, Markdown, DOCX, text-based PDF and PPTX are supported, up to 5 MB and 32000 extracted characters.
PDF extraction uses the existing host's `pdftotext` executable. Scans, figures, complex equations and
layout may need manual transcription. Excess input is rejected rather than silently shortened.

Upload a file OR paste a complete pitch. Prepare block preview uses ELM to select exact source excerpts
for the fields, leaving absent information empty. Inspect the source and preview, explicitly apply it,
edit the blocks and save. Direct block entry does not require AI. Imported binaries are processed in
memory (PDF uses a temporary file removed after extraction); only extracted text is retained with a
saved draft. Saving new content resets human approval. Old source text remains in its private revision.

## Methodology basis

These are adaptations to an early research pitch, not claims of funding or journal compliance:

- [DARPA Heilmeier Catechism](https://www.darpa.mil/about/heilmeier-catechism): express the objective,
  current limitation, proposed contribution, risk, resources, timescale and observable checks.
- [Scientific Reports Registered Reports](https://www.nature.com/srep/journal-policies/registered-reports):
  assess questions and planned methods before the outcome; adapt validation to the research type.
- [UKRI core assessment sections](https://www.ukri.org/apply-for-funding/develop-your-application/responsive-mode-opportunities-funding-service-core-application-section-questions-and-assessment/):
  consider significance, approach, capability, resources and responsible research.

## Checks

`npm run check:idea-check` uses a disposable database for privacy, decisions, version conflicts and
project inheritance. `npm run check:idea-import` checks extraction, limits and editable rule reload.
Set `CHECK_IDEA_ELM=true` for a synthetic live ELM extraction and review test. No real student pitch
is used by these checks. Rule fingerprints record the exact configuration used, not its scientific validity.

## Deleting a pitch

Open a saved pitch and use Delete pitch beside its name. Confirm the named pitch and the checkbox,
then Permanently delete pitch. Cancel makes no changes. Its proposer, a PI or an administrator can delete it.
Deletion removes all its private revisions, extracted source text and AI reviews in one transaction;
a metadata audit record remains. Concurrent version changes require a reload before deletion.
A pitch already converted to a project is read-only and cannot be deleted, preserving its origin.

`CHECK_IDEA_UI=true npm run check:idea-check` additionally exercises the built web UI with a synthetic
cell-counting idea: complete blocks, optional title, rename/history/reload, cancelled switching,
delete cancel/confirm and desktop/tablet/mobile screenshots. Build in an isolated release directory
before running this option; never overwrite the active production `.next` directory for tests.

## Approved document output

After a human Proceed decision, Download approved pitch offers DOCX, PDF, Markdown and plain text.
The default follows the source file extension for these four formats; PPTX and direct block entry
use DOCX. This is a clean document built from structured content, not a reproduction of the source
file layout. Exports contain the current title, eight blocks, proposer, version, recorded decision
actor/time, reason and next step. They exclude previous drafts, source text and AI review history.

Export access is owner/PI/admin only, including after project conversion; read-only collaborators cannot use the export API. Requests specify the expected
current version; unapproved or changed versions are rejected. Responses are private/no-store.
A revised draft clears approval and must be confirmed again before an approved export is available.

PDF uses the existing Playwright Chromium runtime, now an explicit application dependency. Install
its matching browser on a new deployment host with `npx playwright install chromium` and required
OS libraries. The renderer loads only escaped inline document text, disables JavaScript, blocks
network requests, limits concurrent renders and closes the browser after each export. If unavailable,
users can choose DOCX, Markdown or plain text. DOCX generation uses the existing JSZip dependency.

## PI overview and read-only sharing

PI and administrator accounts see All pitches inside Checklists → Idea Pitch, with title/proposer search and status
filters. Each row shows the proposer, decision and version; opening it reveals full private history.
Other accounts see My pitches and explicitly Shared with me groups in the saved-pitch selector.

The proposer, PI or administrator can use Share with collaborators → Add people to select an active username.
Collaborators receive the latest saved blocks, title and human decision only. Source text, older
versions, AI reviews and the collaborator list remain private. They cannot edit, decide, delete,
import, request AI reviews, export or grant access. Removing a collaborator blocks subsequent reads.
Sharing does not add future project membership and sends no notification. Administrators have full access above the PI role and do not need explicit shares.

## Module boundaries and editing safety

The account module owns the active collaboration directory (`/api/users/directory`). Chat keeps
its existing mention-directory API for compatibility; pitch sharing does not initialize or depend
on chat tables. The directory exposes only account ID, username, display label and role.

The pitch editor owns the draft and its expected version. A sharing refresh updates only the
collaborator list, never the draft's version baseline. Sharing also participates in the editor's
busy state so switching or saving waits for it to finish. Reloading an unsaved draft requires
confirmation. Only project creation refreshes the project list; ordinary pitch saves refresh the
pitch list. Database commands that need the current revision fetch one row; full history is loaded
only for the owner/PI/admin history view.

The synthetic UI check covers a concurrent administrator edit followed by a sharing change and
an attempted stale save (409), plus cancelled reload preserving local edits. It also checks normal
save/history, role access, revocation, downloads and responsive layouts. These checks use a disposable
database and do not evaluate the scientific quality of live AI advice.

## English and quality checks

VioScope uses formal English for system-owned UI and generated advice, regardless of input language.
The common prompt policy also applies to chat, artifact summaries and pre-submission reviews.
Original user content and verbatim evidence remain unchanged; pitch evidence quotations belong in
`evidence[].quote`, while summary, assessment, improvement and next steps must be English.
Pitch validation rejects Chinese text in generated advice fields before saving it.

Idea reviews use schema-constrained AI output followed by exact-evidence and completeness validation.
`npm run check:english-policy` checks source/UI content, shared prompt policy and the advice/evidence
boundary. `npm run check:idea-quality` calls the configured model with six synthetic cases and saves
full reports under `.local/checks/idea-quality`. It requires provider access and consumes model calls.
Review these reports semantically as well as checking their schema: valid JSON is not proof of sound
scientific advice. Recommendation labels may vary between `needs_revision` and `insufficient_evidence`
for poorly specified proposals; either is acceptable if the gaps and next tests are justified.


## Approved project to theme meeting handoff

Creating a project in the UI now asks for a first next action (up to 240 characters) and a calendar deadline. The pitch author remains the project owner and is responsible for these project tasks. The approved next milestone becomes the project target; the first action is stored in the existing project TODO list. Additional actions, deadlines and completion are maintained in Projects. Older API clients may still create a project without an initial action.

In Theme Meetings, select an owned active project, review its stage, owner and open actions, then submit explicitly to save its snapshot. Choose “No linked project” for an unlinked update. Existing projects use the same path. The server reads the project itself and rejects another member's project, inaccessible projects and inactive projects. Attaching a project does not add theme membership, submit automatically, confirm an agenda, expose private pitch history or grant project access.

Only the selected project's title, ID, stage, owner and open tasks/deadlines are shared with the meeting audience and agenda email recipients. The update and confirmed agenda retain a snapshot from submission time. Projects remain the source of current state; changing a project stage or completing a task changes the next submission, not past meeting records. Older snapshots without a stage display “Not recorded”. Resubmission refreshes the snapshot, while selecting “No linked project” removes it from that submission. AI slot advice still requires actual progress evidence and never treats a planned action as completed work.
