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
| [~] | I1.5 | `DATASTORE_DIR` is configured. | Internal state/materials can be read from outside public code. | `DATASTORE_DIR=/Public` exists; theme meeting files and VIOS skill roots read successfully (`npm run check:vios-skills` loaded 21 skills). `/Public/lab-state.yaml` is still missing, so real state model readback remains blocked. |
| [x] | I1.6 | Secrets are not in git. | `.env` is ignored and `.env.example` contains only placeholders. | `.env` is git-ignored; `AUTH_SECRET` and `VIOSCOPE_RESTART_COMMAND` are configured locally; Admin Configuration shows only configured/missing secret status. Tracked-file secret scan found only README placeholders/dev examples. |
| [x] | I1.7 | The app can run on EIDF. | Service starts using documented EIDF paths/config. | `vioscope-web.service` is installed as a `systemd --user` service, enabled, active, and serving `http://localhost:3000`; `npm run check:service-restart` verifies admin-triggered restart and audit. No sudo required. |
| [x] | I1.8 | Audit/trace data exists for important agent actions. | You can inspect what action happened, when, and for whom. | `audit_log` table/API and Settings -> Audit log viewer are implemented. `npm run check:audit-log`, `npm run check:audit-coverage`, `npm run check:audit-retention`, Playwright UX, and live chat smoke verify previous-day readback, route coverage, retention pruning, admin-only UI access, and metadata-only chat audit. |
| [x] | I1.9 | Admin runtime configuration exists. | Administrators can view/edit operational settings without exposing secrets. | `app_settings` table, admin-only config API, Settings -> Configuration, restart endpoint, runtime cache, and `AUDIT_LOG_RETENTION_DAYS` are implemented. `npm run check:admin-config` verifies save, revert, cache sync, masked secrets, restart request audit, and retention setting visibility. Most runtime changes still require restart. |

## 2. Accounts, Roles, And Access

| Status | ID | Check | Expected behaviour | Evidence / notes |
|---|---|---|---|---|
| [x] | A2.1 | User can log in. | Valid username/password opens the app. | Backend login and Playwright UX verify valid login; wrong password shows generic `Invalid username or password.` |
| [x] | A2.2 | Invalid login fails safely. | Wrong credentials do not reveal sensitive details. | `npm run check:account-management` verifies wrong password returns the generic invalid-login error. |
| [x] | A2.3 | Account DB stores username, email, password hash, and role. | First-login accounts may start without email; usable accounts must add email before reset is cleared; no plaintext passwords. | `users.email` added to schema/helper/API; `npm run typecheck` and account smoke pass. |
| [x] | A2.4 | Session resolves `user_id`. | User-specific actions are tied to the logged-in account. | `check:users` verifies signed token `sub`; `check:account-management` verifies route access via session cookie. |
| [x] | A2.5 | Member permissions work. | A member edits only their own update/status where allowed. | `npm run check:theme-meeting-auth` passes member update permission check. |
| [x] | A2.6 | Coordinator permissions work. | Coordinator manages only their own theme. | `npm run check:theme-meeting-auth` passes A/B/C/D coordinator checks. |
| [x] | A2.7 | PI permissions work. | PI can review/manage all themes. | `npm run check:theme-meeting-auth` covers PI all-theme visibility/manage path. |
| [x] | A2.8 | Admin permissions work. | Admin can manage all permissions and roles. | `check:account-management` verifies admin user listing and self-protection for disable/demotion. |
| [ ] | A2.9 | Inactive or missing users are rejected in theme config. | `coordinator_user` and `member_users` must match active `users.username`. | |
| [x] | A2.10 | Usable accounts require email. | New first-login accounts can start without email, then must add email while changing password. | Schema/API allow `active + password_reset_required` without email, then require email before reset clears; Settings -> General exposes email editing. |
| [x] | A2.11 | Password minimum is enforced. | User passwords require 8+ chars, 1 letter, 1 digit, and 1 special character. | `123456` and `Password1` rejected; `Password1!` accepted in account-flow smoke. |
| [x] | A2.12 | Temporary weak password supports first-login reset. | Admin can omit temporary password to use username once, then user must add email and choose a stronger password. | Account smoke verifies no-email first-login account, username temporary password, email-required reset, and final password reset clearance. |
| [x] | A2.13 | Settings -> General account edits work. | User can change display name, email, and password; avatar uses upload icon only. | Playwright UX verifies display name/email save, password strength meter, and avatar upload icon with no Avatar URL field. |
| [x] | A2.14 | User management profile edit matches General. | Edit member uses display name, optional first-login email, and avatar upload icon only; admin-only role/status/password controls remain separate. | Playwright UX verifies Edit member profile details, upload icon/no Avatar URL, and separate access-control section. |
| [x] | A2.15 | Disabled and profile-only users cannot log in. | Only active provisioned accounts can authenticate. | `check:account-management` verifies disabled and `profile_only` users return login failure. |
| [x] | A2.16 | Password-reset-required users are gated. | They can read `/me` and change password, but cannot use normal app APIs before reset. | `check:account-management` verifies normal app API returns `403` until password reset succeeds. |
| [x] | A2.17 | Logout clears the session cookie. | Logout response expires `vioscope_session`. | `check:account-management` verifies logout sets `Max-Age=0`. |
| [x] | A2.18 | Account and auth events are auditable. | Login success/failure, logout, password change, profile update, and admin user changes create audit records. | `check:account-management` verifies admin-only audit API access and required account/auth actions in the daily log. |

## 3. Memory

| Status | ID | Check | Expected behaviour | Evidence / notes |
|---|---|---|---|---|
| [ ] | M3.1 | Session memory works. | Follow-up questions remember the current conversation. | |
| [ ] | M3.2 | Personal memory is isolated. | Two users do not see each other's private memory. | |
| [ ] | M3.3 | Public memory is shared. | Shared lab facts are visible to allowed users. | |
| [ ] | M3.4 | Role gates memory access. | Members cannot access PI/admin-only memory or checks. | |
| [ ] | M3.5 | Shared chat does not share personal memory. | A mentioned user sees the chat, not the owner's private memory. | |

## 4. Chat Collaboration

| Status | ID | Check | Expected behaviour | Evidence / notes |
|---|---|---|---|---|
| [ ] | C4.1 | Chat sessions are server-side records. | History survives browser refresh/device change. | |
| [ ] | C4.2 | User owns their own chat sessions. | Own sessions appear under `History`. | |
| [ ] | C4.3 | Mention autocomplete lists active usernames. | Typing `@` shows active `users.username` values. | |
| [ ] | C4.4 | `@username` shares the current session. | Mentioned active user becomes a member of that chat session. | |
| [ ] | C4.5 | Mention creates a notification. | Receiver gets a web notification with a prompt snippet. | |
| [ ] | C4.6 | Shared sessions are separate. | Receiver sees shared chats under `Shared sessions`, not mixed into own `History`. | |
| [ ] | C4.7 | Alert action opens the shared chat. | Clicking the notification takes the receiver to the right session. | |
| [ ] | C4.8 | Alerts support read/unread state. | Read state persists and historical alerts remain visible. | |
| [ ] | C4.9 | Importing legacy local chat does not send mention notifications. | Imported old messages do not notify mentioned users. | |
| [ ] | C4.10 | Chat sharing does not grant write permissions. | Receiver cannot write state/wiki/datastore merely because a chat was shared. | |

## 5. A1 Shared Materials Store

| Status | ID | Check | Expected behaviour | Evidence / notes |
|---|---|---|---|---|
| [ ] | S5.1 | Shared materials are discoverable. | Slides, proposals, demos, and artifacts can be listed or linked. | |
| [ ] | S5.2 | Materials stay outside public code. | Lab-specific files live in internal GitLab or `DATASTORE_DIR`. | |
| [ ] | S5.3 | State model links to artifacts. | Project records include useful `artifacts` references. | |
| [ ] | S5.4 | Large files have a policy. | GitLab LFS or overflow storage is documented/usable. | |

## 6. A2 State Model

| Status | ID | Check | Expected behaviour | Evidence / notes |
|---|---|---|---|---|
| [ ] | ST6.1 | State model file exists. | YAML/Markdown state can be found under external config or `DATASTORE_DIR`. | |
| [ ] | ST6.2 | State model has required human fields. | `owner`, `track`, `stage`, `status`, `stage_since`, `last_update`, `blocker`, `target`, `artifacts`, `watch_path`. | |
| [ ] | ST6.3 | State model has derived fields. | `weeks_in_stage`, `recommendation`, and `signals` are present or computed. | |
| [ ] | ST6.4 | Valid statuses are enforced. | Only `on_track`, `blocked`, `stale`, `needs_input` are accepted. | |
| [ ] | ST6.5 | Stage values are aligned to VIOS OS. | Stages 1-5 match the real theme-meeting stages. | |
| [ ] | ST6.6 | State-reader tool works. | Agent/UI can load and query the current state. | |
| [ ] | ST6.7 | Freshness signals are derived. | Git commits, file mtimes, or wiki edits can flag stale projects. | |
| [ ] | ST6.8 | Recommendations are derived, not hand-filled. | Deep-dive/nudge/none is computed from state/signals. | |
| [ ] | ST6.9 | State changes require confirmation. | Agent suggestions do not write state without explicit human approval. | |
| [ ] | ST6.10 | PI override exists. | PI/admin can review and edit the full board. | |

## 7. B1 Theme Meeting

| Status | ID | Check | Expected behaviour | Evidence / notes |
|---|---|---|---|---|
| [ ] | T7.1 | Four specific themes exist. | A/B/C/D are configured as data, not hard-coded into public code. | |
| [ ] | T7.2 | Alternating cycle works. | A/B one week, C/D the next week. | |
| [ ] | T7.3 | Wednesday slots are correct. | First active theme is 10:00, second active theme is 11:00. | |
| [ ] | T7.4 | Timezone is `Europe/London`. | Summer/winter time works without fixed UTC offsets. | |
| [ ] | T7.5 | Meeting duration is 60 minutes. | Each specific theme meeting lasts 60 minutes. | |
| [ ] | T7.6 | Config references real accounts. | `coordinator_user` and `member_users` use `users.username`. | |
| [ ] | T7.7 | Member update form works. | Member submits about 30 words of progress. | |
| [ ] | T7.8 | Update type choices work. | `nothing_to_report`, `short_update`, `deep_dive`. | |
| [ ] | T7.9 | Question validation works. | Questions required for `short_update` and `deep_dive`, optional for `nothing_to_report`. | |
| [ ] | T7.10 | Durations are assigned. | `short_update` gets about 10 min; `deep_dive` gets about 30 min. | |
| [ ] | T7.11 | Monday reminder works. | Monday 08:00 browser notification goes to relevant members. | |
| [ ] | T7.12 | Tuesday missing-only reminder works. | Tuesday 04:00 reminder goes only to members missing updates. | |
| [ ] | T7.13 | Wednesday cutoff works. | Wednesday 08:00 missing updates become `not_submitted`. | |
| [ ] | T7.14 | Missing updates are excluded from agenda. | `not_submitted` users are not planned into the agenda. | |
| [ ] | T7.15 | Agenda generation works. | Wednesday agenda is a table or bullet list for relevant members and PIs. | |
| [ ] | T7.16 | Agenda confirmation works. | Coordinator, PI, or admin can confirm the advisory agenda. | |
| [ ] | T7.17 | Coordinator can manage members. | Coordinator adds/removes members only for their own theme. | |
| [ ] | T7.18 | Coordinator can send manual reminders. | Manual missing-update reminder works before cutoff. | |
| [ ] | T7.19 | Skip is per theme meeting. | Skipping A does not automatically skip B/C/D. | |
| [ ] | T7.20 | Dashboard shows the useful board. | Person/project stage, status, time-in-stage, who should update, and deep-dive recommendations are visible. | |

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
| [ ] | W9.10 | Re-sync exists. | Scheduled pull or webhook refreshes indexed content. | |
| [ ] | W9.11 | User language is preserved. | Chinese questions get Chinese answers; English questions get English answers. | |

## 10. Web UI And User Experience

| Status | ID | Check | Expected behaviour | Evidence / notes |
|---|---|---|---|---|
| [ ] | UX10.1 | Login screen is clear. | User understands how to enter the app. | |
| [ ] | UX10.2 | Streaming chat works. | Responses appear progressively and recover gracefully on errors. | |
| [ ] | UX10.3 | Navigation is obvious. | User can find Chat, History, Shared sessions, Alerts, and Theme meetings. | |
| [ ] | UX10.4 | Dashboard is scannable. | Important meeting/status information is visible without hunting. | |
| [ ] | UX10.5 | Forms are short and forgiving. | Member update form supports fast completion and useful validation. | |
| [ ] | UX10.6 | Empty states are useful. | No meetings/alerts/history states tell the user what is true, not marketing copy. | |
| [ ] | UX10.7 | Error states are actionable. | User sees what failed and what they can do next. | |
| [ ] | UX10.8 | Browser notifications can be enabled. | App requests permission at a sensible moment and handles denial. | |
| [ ] | UX10.9 | Mobile layout is usable. | Core workflows work on a phone-sized viewport. | |
| [ ] | UX10.10 | Accessibility basics hold. | Keyboard navigation, labels, contrast, and focus states are usable. | |

## 11. Operations And Safety

| Status | ID | Check | Expected behaviour | Evidence / notes |
|---|---|---|---|---|
| [ ] | O11.1 | Backups exist. | Postgres data can be backed up and restored. | |
| [x] | O11.2 | Logs avoid secrets/private content. | Logs are useful without leaking sensitive material. | Audit entries use metadata-only summaries/counts/status/IDs/field names. Live chat smoke verifies `chat.turn` audit records message length/source count but not full prompt or response. Retention is configurable with `AUDIT_LOG_RETENTION_DAYS`. |
| [x] | O11.3 | Important actions are auditable. | State changes, notifications, shares, and verdicts have audit records. | Auth/account/user management, chat turns/imports, theme meeting updates/members/reminders, notification read actions, submission review runs, admin config changes/restart requests, and review save/signoff write `audit_log`; `npm run check:audit-coverage`, `check:audit-log`, `check:audit-retention`, and `check:service-restart` pass. |
| [ ] | O11.4 | Public exposure is controlled. | Internal/VPN mode works before public IP/TLS work begins. | |
| [ ] | O11.5 | Email is clearly backlog. | Browser/web notifications work before local email is attempted. | |
| [ ] | O11.6 | Overleaf integration is clearly backlog. | Settings lists only Overleaf under integrations and marks it as backlog until implementation starts. | |

## Suggested Manual Walkthroughs

| Status | Walkthrough | Steps | Pass condition | Evidence / notes |
|---|---|---|---|---|
| [ ] | Member weekly update | Log in as member, open theme meeting, submit `nothing_to_report`, then edit it. | Update saves, validates correctly, and only affects that member. | |
| [ ] | Short update validation | Submit `short_update` without questions, then with questions. | First attempt is blocked; second succeeds and reserves about 10 minutes. | |
| [ ] | Deep dive agenda | Submit `deep_dive`, generate agenda. | Agenda includes the user with about 30 minutes and shows advisory status. | |
| [ ] | Missing update reminder | Leave one member missing, trigger/check reminder state. | Only missing member is reminded on Tuesday. | |
| [ ] | Coordinator review | Log in as coordinator and manage members/reminders for own theme. | Own theme works; other themes are blocked. | |
| [ ] | PI review | Log in as PI and review all themes. | PI can see/manage all theme agendas. | |
| [ ] | Chat mention | User A sends prompt with `@userB`. | User B gets alert and shared session; no extra permissions are granted. | |
| [x] | Admin configuration | Log in as administrator, open Settings -> Configuration, edit one safe value, save, reset it, then check Audit log. | Config saves/reverts, secrets remain masked, restart button reflects command availability, and audit log records the changes. | `npm run check:admin-config` and Playwright UX pass; service restart is configured and audited. |
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
