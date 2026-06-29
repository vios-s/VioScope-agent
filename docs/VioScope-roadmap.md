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
- Theme meeting identity uses `users.username`; display names are labels only.
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
- Generate cutoff agendas from submitted updates and mark missing updates as `not_submitted`.
- Add coordinator/PI/admin agenda confirmation.
- Keep email delivery optional until browser notification flow is reliable.

Done when: a real weekly cycle can run without developer intervention.

### Phase 3: Project Signal Quality

- Improve project freshness signals from progress updates, artifact changes, and watch paths.
- Make planning recommendations easier to inspect and override.
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
