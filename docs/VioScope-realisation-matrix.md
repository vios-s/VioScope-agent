# VioScope Realisation Matrix

Use this as the working checklist for testing whether VioScope is becoming a real productive tool, not just an MVP demo.

Status key:
- `[ ]` Not checked
- `[x]` Works
- `[~]` Partial
- `[!]` Broken or missing
- `[-]` Not needed now

## How To Use

1. Log in as each relevant role: member, coordinator, PI, admin.
2. Walk through the user-facing checks below.
3. Fill in `Status`, `Evidence`, and `Notes`.
4. Treat anything without evidence as not yet proven.

## 0. Product Posture

| Status | ID | Check | Expected behaviour | Evidence / notes |
|---|---|---|---|---|
| [ ] | P0.1 | The app feels like a work tool, not a toy demo. | A member can complete a real weekly workflow without developer help. | |
| [ ] | P0.2 | The agent is advisory, not authoritative. | Recommendations are framed as suggestions and require human confirmation for actions. | |
| [ ] | P0.3 | Evidence is visible. | Any verdict, recommendation, agenda, or checklist result shows supporting data/source. | |
| [ ] | P0.4 | Unsupported questions are refused honestly. | The app says it lacks evidence instead of guessing. | |
| [ ] | P0.5 | No private lab content is committed to public code. | Site-specific data lives in `DATASTORE_DIR`, env, or internal repos. | |

## 1. Infrastructure

| Status | ID | Check | Expected behaviour | Evidence / notes |
|---|---|---|---|---|
| [x] | I1.1 | ELM chat is configured. | The agent can answer through the ELM OpenAI-compatible API. | `npm run check:elm` passed for chat completion. |
| [x] | I1.2 | ELM embeddings are configured. | Embedding calls work with `ELM_EMBED_MODEL`. | `npm run check:elm` passed for embeddings. |
| [x] | I1.3 | Postgres is available. | App data persists across restarts. | Direct DB ping passed; `npm run check:account-management` creates, authenticates, updates, and restores temporary users through Postgres; a temporary `app_settings` marker persisted across `vioscope-web.service` restart. |
| [x] | I1.4 | pgvector is available if retrieval is enabled. | Vector index/search can run. | The `vector` extension is installed in Postgres and `npm run check:wiki-search -- "VIOS theme meeting"` returned 4 cited wiki results. |
| [x] | I1.5 | `DATASTORE_DIR` is configured. | Internal config/materials can be read from outside public code. | `DATASTORE_DIR=/Public` exists; theme meeting files, VIOS skill roots, upload roots, and GitBook sync state live outside public code. `lab-state.yaml` is no longer a required runtime artifact. |
| [x] | I1.6 | Secrets are not in git. | `.env` is ignored and `.env.example` contains only placeholders. | `.env` is git-ignored; `AUTH_SECRET` and `VIOSCOPE_RESTART_COMMAND` are configured locally; Admin Configuration omits secret values/status from the UI and payload. Tracked-file secret scan found only README placeholders/dev examples. |
| [x] | I1.7 | The app can run on EIDF. | Service starts using documented EIDF paths/config. | `vioscope-web.service` is installed as a `systemd --user` service, enabled, active, and serving `http://localhost:3000`; `npm run check:service-restart` verifies admin-triggered restart and audit. No sudo required. |
| [x] | I1.8 | Audit/trace data exists for important agent actions. | You can inspect what action happened, when, and for whom. | `audit_log` table/API and Settings -> Audit log viewer are implemented. `npm run check:audit-log`, `npm run check:audit-coverage`, `npm run check:audit-retention`, Playwright UX, and live chat smoke verify previous-day readback, route coverage, retention pruning, admin-only UI access, and metadata-only chat audit. |
| [x] | I1.9 | Admin runtime configuration exists. | Administrators can view/edit operational settings without exposing secrets. | `app_settings` table, admin-only config API, Settings -> Configuration, restart endpoint, runtime cache, and `AUDIT_LOG_RETENTION_DAYS` are implemented. `npm run check:admin-config` verifies save, revert, cache sync, omitted secrets payload, restart request audit, and retention setting visibility. Most runtime changes still require restart. |

## 2. Accounts, Roles, And Access

| Status | ID | Check | Expected behaviour | Evidence / notes |
|---|---|---|---|---|
| [x] | A2.1 | User can log in. | Valid username/password opens the app. | Backend login and Playwright UX verify valid login; wrong password shows generic `Invalid username or password.` |
| [x] | A2.2 | Invalid login fails safely. | Wrong credentials do not reveal sensitive details. | `npm run check:account-management` verifies wrong password returns the generic invalid-login error. |
| [x] | A2.3 | Account DB stores username, email, password hash, permission, and position metadata. | First-login accounts may start without email; usable accounts must add email before reset is cleared; no plaintext passwords. | `users.email`, permission role, and `metadata.position` are exposed through schema/helper/API; `npm run typecheck` and account smoke pass. |
| [x] | A2.4 | Session resolves `user_id`. | User-specific actions are tied to the logged-in account. | `check:users` verifies signed token `sub`; `check:account-management` verifies route access via session cookie. |
| [x] | A2.5 | Member permissions work. | A member edits only their own update/status where allowed. | `npm run check:theme-meeting-auth` passes member update permission check. |
| [x] | A2.6 | Coordinator permissions work. | Coordinator manages only their own theme. | `npm run check:theme-meeting-auth` passes A/B/C/D coordinator checks. |
| [x] | A2.7 | PI permissions work. | PI can review/manage all themes. | `npm run check:theme-meeting-auth` covers PI all-theme visibility/manage path. |
| [x] | A2.8 | Admin permissions work. | Admin can manage access permissions, positions, and account status. | `check:account-management` verifies admin user listing, position create/update, and self-protection for disable/demotion. |
| [ ] | A2.9 | Inactive or missing users are rejected in theme config. | `coordinator_user` and `member_users` must match active `users.username`. | |
| [x] | A2.10 | Usable accounts require email. | New first-login accounts can start without email, then must add email while changing password. | Schema/API allow `active + password_reset_required` without email, then require email before reset clears; Settings -> General exposes email editing. |
| [x] | A2.11 | Password minimum is enforced. | User passwords require 8+ chars, 1 letter, 1 digit, and 1 special character. | `123456` and `Password1` rejected; `Password1!` accepted in account-flow smoke. |
| [x] | A2.12 | Temporary weak password supports first-login reset. | Admin can omit temporary password to use username once, then user must add email and choose a stronger password. | Account smoke verifies no-email first-login account, username temporary password, email-required reset, and final password reset clearance. |
| [x] | A2.13 | Settings -> General account edits work. | User can change display name, email, and password; avatar uses upload icon only. | Playwright UX verifies display name/email save, password strength meter, and avatar upload icon with no Avatar URL field. |
| [x] | A2.14 | User management profile edit matches General. | Edit member uses display name, optional first-login email, position, and avatar upload icon only; admin-only permission/status/password controls remain separate. | Playwright UX verifies Edit member profile details, upload icon/no Avatar URL, and separate access-control section; account smoke verifies position create/update. |
| [x] | A2.15 | Disabled and profile-only users cannot log in. | Only active provisioned accounts can authenticate. | `check:account-management` verifies disabled and `profile_only` users return login failure. |
| [x] | A2.16 | Password-reset-required users are gated. | They can read `/me` and change password, but cannot use normal app APIs before reset. | `check:account-management` verifies normal app API returns `403` until password reset succeeds. |
| [x] | A2.17 | Logout clears the session cookie. | Logout response expires `vioscope_session`. | `check:account-management` verifies logout sets `Max-Age=0`. |
| [x] | A2.18 | Account and auth events are auditable. | Login success/failure, logout, password change, profile update, and admin user changes create audit records. | `check:account-management` verifies admin-only audit API access and required account/auth actions in the daily log. |

## 3. Memory

| Status | ID | Check | Expected behaviour | Evidence / notes |
|---|---|---|---|---|
| [x] | M3.1 | Session memory works. | Follow-up questions remember the current conversation. | `npm run check:memory` uses live `/api/chat` + LLM generation; same `threadId` recalls a unique prior session code. |
| [x] | M3.2 | Personal memory is isolated. | Two users do not see each other's private memory. | `npm run check:memory` creates separate `DATASTORE_DIR/users/<slug>/memory.md` files; Alice and Bob each retrieve only their own unique code. |
| [x] | M3.3 | Public memory is shared. | Shared lab facts are visible to allowed users. | `npm run check:memory` verifies shared public context remains readable to allowed users; project operations now use Project Manager DB records rather than requiring `lab-state.yaml`. |
| [x] | M3.4 | Role gates memory access. | Members cannot access PI/admin-only memory or checks. | No separate shared PI/admin memory store exists yet; personal datastore memory is isolated by signed-in user in `npm run check:memory`. Admin-only settings/audit APIs remain route-gated. Project tools use server-side request context and DB visibility filters, not model-supplied user IDs. |
| [~] | M3.5 | Shared chat does not share personal memory. | A mentioned user sees the chat, not the owner's private memory. | `npm run check:memory` verifies a mentioned user cannot directly retrieve the owner's private user-path memory from a shared session. Still needs product rule for explicit disclosure: if the owner asks the assistant to reveal private memory inside a shared chat, the answer text itself can be shared. |

## 3.5 Project Management

| Status | ID | Check | Expected behaviour | Evidence / notes |
|---|---|---|---|---|
| [x] | PM3.5.1 | Project Manager has persistent DB/API records. | Projects are stored in Postgres with full title, slug, owner, collaborators, track, lifecycle, venue, deadline, watch path, notes, artifacts, progress updates, and comments. | `project_records`, `project_artifacts`, `project_updates`, and `project_update_comments` tables plus `/api/projects` routes are implemented. Track is limited to A/B, stage is 1-5, stage progress is 0-100, watch path is generated from owner/slug, duplicate full project names are blocked per owner, and project progress updates store/sync stage, stage progress, status, target, blocker, and milestone. `npm run check:projects` passes. |
| [x] | PM3.5.2 | Project visibility follows project/theme permission rules. | Owner, the owner's theme coordinator, and PI/admin can see project details; collaborators are metadata only; outsiders and unrelated coordinators cannot. | `npm run check:projects` verifies owner visibility, owner-theme coordinator visibility, collaborator/outsider denial, and that project Track A/B is not treated as theme meeting A/B. Coordinator visibility alone does not grant project editing. |
| [~] | PM3.5.3 | Dashboard project UI follows the operations-console design. | Member dashboard shows own/visible projects with Add project plus separate icon-only Details and Progress update actions; PI/admin sees a lab-wide table plus project-planning brief with the same detail/progress entry points. | Dashboard now loads Project Manager records, uses full project name before generated slug, collaborator hints allow comma-separated internal/external names, Details edits static metadata, Progress update captures stage/progress/status/target/blocker/milestone and artifact upload, archived projects are grayed/retained/unarchivable, and PI/admin can run a planning scan showing attention items above updated projects. `npm run check:project-ui` now covers empty-member create, member details edit, progress word-limit/valid update, archive/unarchive, PI lab-wide brief, and admin lab-wide brief. `npm run check:projects`, `npm run typecheck`, and `npm run check:theme-meeting-ui` also pass; still needs manual desktop UX pass before marking complete. |
| [~] | PM3.5.4 | Agent can read project details safely. | Chat can fetch only projects visible to the signed-in user and can build a project-progress brief. | `list-visible-projects`, `get-project-detail`, and `check-project-progress` Mastra tools are registered and use server-side `RequestContext` user data. `/api/projects/planning` builds the same brief for PI/admin UI. `npm run check:projects` verifies planning scan contents and audit; still needs live chat/tool-call smoke before marking complete. |
| [x] | PM3.5.5 | Artifacts do not crowd agent context. | Old files are retained, but the agent sees current summaries by default. | Artifact rows keep all versions; same artifact key marks older versions `is_current=false`. `npm run check:projects` verifies two versions retained and only the latest is current. Project tools return current artifact summaries by default, not file bodies. |
| [x] | PM3.5.6 | Project operations are auditable without content leakage. | Create/edit/archive/update/comment/planning-scan actions write safe metadata only. | Project APIs record `project.create`, `project.update`, `project.archive`, `project.update_add`, `project.update_comment`, and `project.planning_scan`; `npm run check:projects` verifies actions and planning scan audit, and `npm run check:audit-coverage` covers mutating routes. |
| [x] | PM3.5.7 | Artifact upload pipeline exists. | Uploads can store files, extract zip files, generate artifact summaries automatically, and support artifact lifecycle actions. | Implemented for `.docx`, `.pptx`, `.pdf`, `.zip`, and text-like files with a 20 MB per-file limit. Files store under `PROJECT_ARTIFACT_UPLOAD_DIR` or `DATASTORE_DIR/uploads/projects`; zip uploads are extracted to a sibling `.extracted` folder; ELM generates concise artifact digests with local fallback. UI supports download, soft-remove, manual digest regeneration, and upload progress. `npm run check:project-artifacts` creates mock `Educational Agent with Memory` uploads for docx/pptx/pdf/zip and verifies LLM digests, zip extraction, download, remove, manual digest, audit metadata, and the 20 MB limit. |

## 4. Chat Collaboration

| Status | ID | Check | Expected behaviour | Evidence / notes |
|---|---|---|---|---|
| [x] | C4.1 | Chat sessions are server-side records. | History survives browser refresh/device change. | `npm run check:chat-collaboration` verifies `chat_sessions`, `chat_messages`, `chat_session_members`, and `/api/chat/sessions` return server-side sessions. |
| [x] | C4.2 | User owns their own chat sessions. | Own sessions appear under `History`. | `npm run check:chat-collaboration` verifies the owner sees the saved thread with `membershipKind=owner`. |
| [x] | C4.3 | Mention autocomplete lists active usernames. | Typing `@` shows active `users.username` values. | `npm run check:chat-collaboration` verifies `listMentionableUsers` includes active users and excludes disabled users; the Chat UI uses the same active-user feed for `@` suggestions. |
| [x] | C4.4 | `@username` shares the current session. | Mentioned active user becomes a member of that chat session. | `npm run check:chat-collaboration` verifies `shareChatSessionWithMentions` adds the mentioned active user and reports unknown mentions separately. |
| [x] | C4.5 | Mention creates a notification. | Receiver gets a web notification with a prompt snippet. | `npm run check:chat-collaboration` verifies a mention creates one unread notification for the receiver, and verifies a user who disables `chat_mentions.web` still receives shared-session access but no Alerts notification. Chat mentions are web-only; email is forcibly disabled. |
| [x] | C4.6 | Shared sessions are separate. | Receiver sees shared chats under `Shared sessions`, not mixed into own `History`. | `npm run check:chat-collaboration` verifies the receiver sees the thread with `membershipKind=shared`, not as owned history, and shared messages expose sender username/display/avatar metadata for the chat UI. |
| [~] | C4.7 | Alert action opens the shared chat. | Clicking the notification takes the receiver to the right session. | Frontend path exists: Alerts calls `openChatSessionFromNotification`, which switches to Chat, opens the target thread, and marks the notification read. Needs a Playwright click-through check before marking complete. |
| [x] | C4.8 | Alerts support read/unread state. | Read state persists and historical alerts remain visible. | `npm run check:chat-collaboration` verifies mark-read persists and read notifications remain historically visible. |
| [x] | C4.9 | Importing legacy local chat does not send mention notifications. | Imported old messages do not notify mentioned users. | `npm run check:chat-collaboration` imports a legacy message containing `@username` and verifies no new notification is sent. |
| [x] | C4.10 | Chat sharing does not grant write permissions. | Receiver cannot write state/wiki/datastore merely because a chat was shared. | `npm run check:chat-collaboration` verifies a shared-chat receiver cannot see or update the owner's private project. |

## 5. A1 Shared Materials Store

| Status | ID | Check | Expected behaviour | Evidence / notes |
|---|---|---|---|---|
| [ ] | S5.1 | Shared materials are discoverable. | Slides, proposals, demos, and artifacts can be listed or linked. | |
| [ ] | S5.2 | Materials stay outside public code. | Lab-specific files live in internal GitLab or `DATASTORE_DIR`. | |
| [x] | S5.3 | Project state links to artifacts. | Project records include useful `artifacts` references. | Project Manager records include artifact title/kind/path/summary/key/current-version metadata. `npm run check:projects` verifies versioned artifact retention. |
| [ ] | S5.4 | Large files have a policy. | GitLab LFS or overflow storage is documented/usable. | |

## 6. A2 Project State Model

| Status | ID | Check | Expected behaviour | Evidence / notes |
|---|---|---|---|---|
| [x] | ST6.1 | Project state exists without YAML. | Operational state is stored in Postgres Project Manager records, not a required `lab-state.yaml` file. | `project_records`, `project_artifacts`, `project_updates`, and comments tables are implemented; `npm run check:projects` passes. |
| [x] | ST6.2 | State model has required human fields. | `owner`, `collaborators`, `track`, `stage`, `stage_progress`, `status`, `blocker`, `target`, `venue`, `submission_deadline`, `artifacts`, `watch_path`, and notes are stored. | `npm run check:projects` verifies create/update/readback for these fields; `npm run check:project-ui` verifies member UI entry points. |
| [~] | ST6.3 | State model has derived fields. | `needs_update`, `overdue`, `attention_reason`, and `recommendation` are present or computed. | Project API/planning scan computes attention and recommendations; deeper git/wiki freshness signals remain future work. |
| [x] | ST6.4 | Valid statuses are enforced. | Only supported project statuses are accepted. | Project schema/API constrain status values; `npm run check:projects` verifies update validation paths. |
| [x] | ST6.5 | Stage values are aligned to VIOS OS. | Stages 1-5 plus stage progress 0-100 are enforced. | `npm run check:projects` and `npm run check:project-ui` verify stage and stage-progress update flow. |
| [x] | ST6.6 | State-reader tool works. | Agent/UI can load and query the current project state. | `/api/projects`, `/api/projects/planning`, and project Mastra tools are implemented; `npm run check:projects` passes. |
| [ ] | ST6.7 | Freshness signals are derived. | Git commits, file mtimes, or wiki edits can flag stale projects. | |
| [~] | ST6.8 | Recommendations are derived, not hand-filled. | Theme-meeting/planning recommendations are computed from project state and updates. | Project planning scan computes attention/recommendation output; git/wiki signal-derived recommendations remain future work. |
| [x] | ST6.9 | State changes require confirmation. | Agent suggestions do not write state without explicit human action. | Project changes go through authenticated API/UI actions and are audited; chat sharing does not grant project write permissions. |
| [x] | ST6.10 | PI override exists. | PI/admin can review and edit the full board. | `npm run check:projects` verifies PI/admin visibility/edit paths; `npm run check:project-ui` verifies lab-wide UI. |

## 7. B1 Theme Meeting

| Status | ID | Check | Expected behaviour | Evidence / notes |
|---|---|---|---|---|
| [ ] | T7.1 | Four specific themes exist. | A/B/C/D are configured as data, not hard-coded into public code. | |
| [ ] | T7.2 | Alternating cycle works. | A/B one week, C/D the next week. | |
| [ ] | T7.3 | Wednesday slots are correct. | First active theme is 10:00, second active theme is 11:00. | |
| [ ] | T7.4 | Timezone is `Europe/London`. | Summer/winter time works without fixed UTC offsets. | |
| [ ] | T7.5 | Meeting duration is 60 minutes. | Each specific theme meeting lasts 60 minutes. | |
| [~] | T7.6 | Config references real accounts. | `coordinator_user` and `member_users` use `users.username`. | External theme meeting config uses username fields; public team profile imports now default to active profile records so theme-meeting references can resolve, while roles/passwords remain a separate admin confirmation step. |
| [x] | T7.7 | Project progress update form works. | Active project owner submits a <=50-word bi-weekly progress update with stage, stage progress, status, target, blocker, milestone, and optional artifact. | Project Manager now has separate Details and Progress update entry points; progress updates sync current project stage/status fields. `npm run check:projects`, `npm run check:project-artifacts`, and `npm run check:theme-meeting-ui` pass. |
| [x] | T7.8 | Theme slot choices work. | Theme-meeting slot types are `nothing_to_report`, `deep_dive`, `milestone_check`, and `strategic_slot`. | Legacy choices were removed from schema/UI/tests while keeping `nothing_to_report`. `npm run check:theme-meetings`, `npm run check:theme-meeting-auth`, and `npm run check:theme-meeting-ui` pass. |
| [x] | T7.9 | Progress word limit works. | Progress text is limited to 50 words for project progress updates. | API/UI validation added; `npm run check:projects` verifies over-limit rejection. |
| [x] | T7.10 | Durations are assigned. | `nothing_to_report` gets 0 min, `milestone_check`/`strategic_slot` get about 10 min, and `deep_dive` gets about 20-30 min. | Theme config defaults assign 0 min to nothing-to-report, 10 min to milestone/strategic slots, and 30 min to deep dives; `npm run check:theme-meetings` passes. |
| [ ] | T7.11 | First reminder works. | Configured first reminder weekday/time sends a browser notification to active project owners with missing/overdue progress. | |
| [ ] | T7.12 | Missing-only reminder works. | Configured missing-update reminder weekday/time goes only to active project owners still missing progress. | |
| [ ] | T7.13 | Cutoff works. | Configured cutoff weekday/time marks missing project progress updates for the cycle. | |
| [ ] | T7.14 | Missing updates are excluded from agenda. | Projects without current progress are not planned into the agenda unless coordinator/PI overrides. | |
| [~] | T7.15 | Agenda generation works. | Configured-cutoff agenda is a table or bullet list for relevant members and PIs. | PI/admin can manually run a project-planning brief that lists attention items first and updated projects second; `npm run check:project-ui` verifies the brief UI. Automated agenda generation, delivery, and confirmation are still pending. |
| [ ] | T7.16 | Agenda confirmation works. | Coordinator, PI, or admin can confirm the advisory agenda. | |
| [x] | T7.17 | Coordinator can manage members. | Coordinator adds/removes members only for their own theme. | Settings -> Theme meeting is visible to coordinators, PIs, and admins. Coordinators can save member changes only for their own theme; PIs/admins can open global theme settings. `npm run check:theme-meeting-auth` and `npm run check:theme-meeting-ui` pass. |
| [ ] | T7.18 | Coordinator can send manual reminders. | Manual missing-update reminder works before cutoff. | |
| [ ] | T7.19 | Skip is per theme meeting. | Skipping A does not automatically skip B/C/D. | |
| [~] | T7.20 | Dashboard shows the useful board. | Person/project stage, status, time-in-stage, who should update, and deep-dive recommendations are visible. | Dashboard now shows Project Manager project cards/table with owner, collaborators, track, stage, lifecycle, status, target, blocker, deadline, artifacts, details, timeline, and a PI/admin project-planning brief. Playwright desktop smoke passes; still needs manual desktop UX and tighter theme-meeting deep-dive integration. |

## 8. B2 Pre-Submission Agent

| Status | ID | Check | Expected behaviour | Evidence / notes |
|---|---|---|---|---|
| [ ] | PS8.1 | Draft input works. | User can provide PDF, LaTeX upload, or Overleaf link. | Overleaf import is backlog; do not imply GitLab/DataStore/Drive integrations for this slice. |
| [ ] | PS8.2 | Skeleton Lock checklist runs. | Output includes evidence-backed checklist results. | |
| [ ] | PS8.3 | PDRA meta-review runs. | Output includes review observations and evidence. | |
| [ ] | PS8.4 | Red-team prompt runs. | Output identifies risks/weaknesses with evidence. | |
| [ ] | PS8.5 | Verdict suggestion works. | Agent suggests `CLEARED`, `CONDITIONAL`, or `SLIDE`. | |
| [ ] | PS8.6 | Mitigation table is produced. | Conditional/slide cases include concrete mitigation items. | |
| [ ] | PS8.7 | 14-day countdown is tracked. | User can see deadline/cadence context. | |
| [ ] | PS8.8 | Human sign-off is required. | No submission verdict is treated as final without approval. | |
| [ ] | PS8.9 | Checks are portable skills. | Each VIOS check is represented as `SKILL.md`. | |

## 9. B3 Wiki Q&A

| Status | ID | Check | Expected behaviour | Evidence / notes |
|---|---|---|---|---|
| [ ] | W9.1 | GitBook source is available. | App can pull or query GitBook content. | |
| [ ] | W9.2 | Confluence source is available when needed. | App can query internal Edinburgh wiki from EIDF. | |
| [ ] | W9.3 | Ingestion preserves metadata. | Chunks include source, page title, section, URL, date, confidentiality. | |
| [ ] | W9.4 | Vector retrieval works. | User question returns relevant chunks with citation metadata. | |
| [ ] | W9.5 | Answers cite sources. | Claims include inline source links. | |
| [ ] | W9.6 | Low-confidence refusal works. | Out-of-coverage question is refused instead of guessed. | |
| [ ] | W9.7 | KB gaps are logged. | Refused in-scope questions are recorded for later wiki updates. | |
| [ ] | W9.8 | No automatic wiki write-back. | Proposed wiki updates require human confirmation. | |
| [ ] | W9.9 | Evaluation set can run. | Faithfulness/relevance or IR checks can be executed. | |
| [x] | W9.10 | Re-sync exists. | Scheduled pull or webhook refreshes indexed content. | `npm run sync:gitbook` checks the GitBook revision/page timestamps, skips unchanged content, and runs full `ingest:gitbook` on change. Verified first run re-indexed 58 pages / 85 chunks, second run skipped unchanged content, `check:wiki-search` still passed, and a daily 03:17 current-user cron entry writes to `/Public/logs/vioscope-gitbook-sync.log`. |
| [ ] | W9.11 | User language is preserved. | Chinese questions get Chinese answers; English questions get English answers. | |

## 10. Web UI And User Experience

| Status | ID | Check | Expected behaviour | Evidence / notes |
|---|---|---|---|---|
| [ ] | UX10.1 | Login screen is clear. | User understands how to enter the app. | |
| [ ] | UX10.2 | Streaming chat works. | Responses appear progressively and recover gracefully on errors. | |
| [ ] | UX10.3 | Navigation is obvious. | User can find Chat, History, Shared sessions, Alerts, and Theme meetings. | |
| [~] | UX10.4 | Dashboard is scannable. | Important meeting/status information is visible without hunting. | Dashboard layout follows the design direction with summary strip, project cards, attention panel, project table, PI/admin planning brief, detail modal, and timeline. Playwright desktop smoke covers member, empty member, PI, and admin views; still needs manual desktop walkthrough before marking complete. |
| [~] | UX10.5 | Forms are short and forgiving. | Project progress update form supports fast completion and useful validation. | Project cards now expose separate Details and Progress update actions. Progress update captures current stage/progress/status/target/blocker/milestone in one form and limits progress text to 50 words. `npm run check:project-ui` verifies empty-member project creation, member Details/Progress update, word-limit validation, archive/unarchive, and PI/Admin planning scans; still needs manual desktop walkthrough. |
| [~] | UX10.6 | Empty states are useful. | No meetings/alerts/history states tell the user what is true, not marketing copy. | Meeting tab no longer goes blank for members whose own theme is off-cycle: it shows this week's overview, the next theme slot form when available, and recent past meetings. Playwright smoke covers member/coordinator/PI/admin meeting views; Alerts/history still need separate review. |
| [ ] | UX10.7 | Error states are actionable. | User sees what failed and what they can do next. | |
| [~] | UX10.8 | Browser notifications can be enabled. | App requests permission at a sensible moment and handles denial. | Settings -> Notifications now has two columns for Web and Email preferences, saves per-user preferences through `/api/account`, and includes a browser permission button. Chat mentions are web-only. `npm run check:account-management` and `npm run check:project-ui` verify persistence and UI. Native browser reminder delivery still needs the scheduled reminder workflow. |
| [-] | UX10.9 | Mobile layout is usable. | Core workflows work on a phone-sized viewport. | Not a v1 target; this internal tool is desktop/laptop first. |
| [ ] | UX10.10 | Accessibility basics hold. | Keyboard navigation, labels, contrast, and focus states are usable. | |

## 11. Operations And Safety

| Status | ID | Check | Expected behaviour | Evidence / notes |
|---|---|---|---|---|
| [ ] | O11.1 | Backups exist. | Postgres data can be backed up and restored. | |
| [x] | O11.2 | Logs avoid secrets/private content. | Logs are useful without leaking sensitive material. | Audit entries use metadata-only summaries/counts/status/IDs/field names. Live chat smoke verifies `chat.turn` audit records message length/source count but not full prompt or response. Retention is configurable with `AUDIT_LOG_RETENTION_DAYS`. |
| [x] | O11.3 | Important actions are auditable. | State changes, notifications, shares, and verdicts have audit records. | Auth/account/user management, project create/edit/archive/update/comment, chat turns/imports, theme meeting updates/members/reminders, notification read actions, submission review runs, admin config changes/restart requests, and review save/signoff write `audit_log`; `npm run check:audit-coverage`, `check:audit-log`, `check:audit-retention`, `check:service-restart`, and `check:projects` pass. |
| [ ] | O11.4 | Public exposure is controlled. | Internal/VPN mode works before public IP/TLS work begins. | |
| [~] | O11.5 | Email is clearly backlog. | Browser/web notifications work before local email is attempted. | Per-user Email preferences exist and default on for reminder/checklist/brief topics, while chat mentions are web-only. Actual reminder email delivery still depends on the scheduled reminder workflow and SMTP configuration. |
| [ ] | O11.6 | Overleaf integration is clearly backlog. | Settings lists only Overleaf under integrations and marks it as backlog until implementation starts. | |

## Suggested Manual Walkthroughs

| Status | Walkthrough | Steps | Pass condition | Evidence / notes |
|---|---|---|---|---|
| [x] | Member bi-weekly progress update | Log in as member, open Dashboard, click project Progress update, submit <=50 words with stage progress. | Update saves, syncs the project card, and only affects that member's visible project. | `npm run check:project-ui` verifies member progress update and dashboard sync. |
| [x] | Progress word-limit validation | Submit a project progress update over 50 words, then a valid one. | First attempt is blocked; second succeeds. | `npm run check:project-ui` verifies the 51-word rejection and valid retry. |
| [ ] | Theme slot agenda | Submit/derive `nothing_to_report`, `deep_dive`, `milestone_check`, or `strategic_slot`, generate agenda. | Agenda shows the chosen/recommended slot and advisory status; `nothing_to_report` contributes 0 minutes. | |
| [ ] | Missing update reminder | Leave one member missing, trigger/check reminder state. | Only the missing member is reminded on the configured missing-update reminder. | |
| [ ] | Coordinator review | Log in as coordinator and manage members/reminders for own theme. | Own theme works; other themes are blocked. | |
| [ ] | PI review | Log in as PI and review all themes. | PI can see/manage all theme agendas. | |
| [ ] | Chat mention | User A sends prompt with `@userB`. | User B gets alert and shared session; no extra permissions are granted. | |
| [x] | Admin configuration | Log in as administrator, open Settings -> Configuration, edit one safe value, save, reset it, then check Audit log. | Config saves/reverts, secrets are omitted, restart button reflects command availability, and audit log records the changes. | `npm run check:admin-config` and Playwright UX pass; service restart is configured and audited. |
| [x] | Audit log viewer | Log in as administrator, open Settings -> Audit log, choose a daily log file from the Year/Month list or use the date input, then perform one account/chat action and refresh. | Daily log shows the action with actor, target, summary, and safe metadata; member accounts cannot open the viewer. | Playwright UX verifies Year/Month log file list and admin-only access; `npm run check:audit-log` verifies previous-day readback. |
| [x] | Wiki supported answer | Ask a known KB question. | Answer cites correct source. | `npm run check:wiki-search -- "VIOS theme meeting"` returns cited source metadata; `npm run check:chat-live` returns a chat answer with 2 sources. |
| [ ] | Wiki unsupported answer | Ask an uncovered but relevant question. | App refuses honestly and logs a gap. | |
| [ ] | Pre-submission review | Submit a draft or test fixture. | Agent returns evidence-backed verdict suggestion pending human approval. | |

## Priority For Productive Use

| Rank | Area | Why it matters |
|---|---|---|
| 1 | Login, roles, and session stability | Without identity, meeting permissions and shared chat cannot be trusted. |
| 2 | Theme meeting dashboard and update form | This is the main near-term productive workflow. |
| 3 | Reminder, cutoff, and agenda workflow | This turns the app from passive dashboard into a weekly operating tool. |
| 4 | Chat sharing and Alerts | This supports collaboration without leaking personal/state permissions. |
| 5 | Evidence and human confirmation gates | This keeps the system advisory and safe. |
| 6 | Wiki Q&A and pre-submission checks | Useful, but not the current main build priority unless the team wants to resume them. |
