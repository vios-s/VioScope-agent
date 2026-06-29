# VioScope Agent

Mastra + TypeScript scaffold for the VioScope agent system. The current direction is tracked in
[docs/VioScope-roadmap.md](docs/VioScope-roadmap.md).

## Setup

### Prerequisites

- Node.js matching `.nvmrc` or any compatible Node `>=22.13.0`.
- Docker Compose for the local Postgres + pgvector database.
- External runtime/config storage outside this repository, for example `/Public` on EIDF.

### Install

```bash
nvm use
npm install
cp .env.example .env
git config core.hooksPath .githooks
```

Edit `.env` before running the app. Keep `.env`, internal state, skills, and lab materials out of git.

The Git hook runs `npm run precommit`, which currently performs the TypeScript check before each commit.

Minimum useful local values:

```bash
ELM_API_KEY=...
AUTH_SECRET=...
DATABASE_URL=postgresql://vioscope:vioscope_dev@localhost:5432/vioscope
DATASTORE_DIR=/Public
VIOS_SKILLS_DIR=/Public/skills/vios-research-skills:/Public/skills/vios-private-skills
```

For wiki ingestion, also set `GITBOOK_TOKEN` and `GITBOOK_SPACE`. `GITBOOK_SPACE` is the app space id from `https://app.gitbook.com/o/<org_id>/s/<space_id>`, not the public docs URL.

### External Data

Keep site-specific files under `DATASTORE_DIR` or another internal repo, not this code repo. Useful optional paths:

```text
/Public/theme-meeting-config.yaml
/Public/theme-meeting-updates.yaml
/Public/theme-meeting-notifications.yaml
/Public/team/vios-team-public.md
/Public/skills/vios-research-skills/
/Public/skills/vios-private-skills/
/Public/runtime/mastra.db
/Public/users/<user>/memory.md
/Public/users/<user>/projects/<project>/
/Public/uploads/submission-review/
```

If your paths differ, set `THEME_MEETING_CONFIG_PATH`, `TEAM_PROFILE_MARKDOWN`, `MASTRA_STORAGE_URL`, or `SUBMISSION_REVIEW_UPLOAD_DIR` in `.env`.
The files under `fixtures/` are examples and test inputs only; the running app does not use them as production theme-meeting configuration.

### Database

Start the local database:

```bash
npm run db:up
```

Stop it when needed:

```bash
npm run db:down
```

Create a dated Postgres snapshot:

```bash
npm run db:snapshot
```

The default snapshot path is `backups/vioscope-postgres-YYYY-MM-DD.dump`. Each default snapshot run prunes snapshots older than `POSTGRES_BACKUP_RETENTION_DAYS` days, which defaults to 14. Schedule `npm run db:snapshot` once per day with cron or systemd on the deployment host.

Restore requires an explicit destructive confirmation:

```bash
npm run db:restore -- backups/vioscope-postgres-YYYY-MM-DD.dump --yes
```

### Local Email

Start the local Mailpit SMTP catcher:

```bash
npm run mail:up
```

Set `EMAIL_NOTIFICATIONS_ENABLED=true` in `.env`, then open `http://127.0.0.1:8025` to inspect captured emails. The app sends through `SMTP_HOST`/`SMTP_PORT`; production should use an institutional SMTP relay rather than direct local delivery.

### Verify

Run the cheap checks first:

```bash
npm run typecheck
npm run check:users
npm run check:theme-meetings
npm run check:vios-skills
```

Checks that require configured services:

```bash
npm run check:elm
npm run check:gitbook
npm run ingest:gitbook
npm run sync:gitbook
npm run check:wiki-search -- "induction"
npm run check:vioscope
```

`sync:gitbook` checks the current GitBook revision/page timestamps before indexing. If nothing changed,
it exits without touching the vector index; if content changed, it runs the same full re-ingest as
`ingest:gitbook`. The sync marker is stored at `DATASTORE_DIR/runtime/gitbook-sync-state.json` by default.

Daily EIDF cron example:

```cron
17 3 * * * /bin/bash -lc 'cd /path/to/VioScope-agent && npm --silent run sync:gitbook >> /Public/logs/vioscope-gitbook-sync.log 2>&1'
```

### Run

Start the Next.js web UI:

```bash
npm run web:dev
```

Open `http://localhost:3000`.

Start Mastra Studio separately when needed:

```bash
npm run dev
```

Studio is typically served at `http://localhost:4111`.

### Optional Workflows

Dry-run public team profile import:

```bash
npm run users:import-team
npm run users:seed-memory
```

Create a first-login local account. With no password argument, the username is used once and the user must add email and reset password before normal app access:

```bash
npm run users:create -- alice member
```

Run a local B2 pre-submission review:

```bash
npm run review:submission -- ./draft.md --target "NeurIPS" --deadline "2026-09-15"
```

Supported v1 draft formats are text-like files (`.md`, `.txt`, `.tex`, `.latex`, `.rst`) and PowerPoint `.pptx` decks. Export PDFs and legacy `.ppt` files to one of those formats first.

## Repository Posture

- Public code stays generic and Apache-2.0.
- Internal content is read from `DATASTORE_DIR` and must stay outside this repository.
- Secrets live in local environment configuration or an EIDF secrets store.
- Agent output is advisory and should cite supporting evidence once retrieval is wired in.
- Unsupported wiki/lab questions can be logged to `kb_gaps` for triage; this is not an authoritative knowledge store.
- Runtime skills are loaded from `VIOS_SKILLS_DIR` and must stay outside this repository unless they are generic enough to publish.
- Public team profiles can seed active profile records for theme-meeting references, but roles and passwords still require human confirmation.

## Project State

Project Manager database records are the operational source of truth for the dashboard, progress updates, artifacts, planning scans, and permission checks. The old `lab-state.yaml` API, reader, tools, and fixture have been removed.

## Runtime Skills

`VIOS_SKILLS_DIR` can point at a clone of `vios-s/Vios-Research-Skills`, a private fork, or a path-delimited list of roots. Each root may be a repository containing `skills/<name>/SKILL.md`, a directory containing skill folders, or a single skill folder. Later roots override earlier roots by skill name.

Recommended external shape:

```bash
git clone https://github.com/vios-s/Vios-Research-Skills /Public/skills/vios-research-skills
mkdir -p /Public/skills/vios-private-skills
VIOS_SKILLS_DIR=/Public/skills/vios-research-skills:/Public/skills/vios-private-skills npm run check:vios-skills
```

Keep VIOS OS checklist skills private until they are sanitized. Generic, reusable versions can be contributed upstream to `vios-s/Vios-Research-Skills`.

Current B2 private skill names:

- `vios-skeleton-lock`
- `vios-pdra-meta-review`
- `vios-revision-lock`
- `vios-internal-red-team`

Keep private skill implementations under the external private skills root configured by `VIOS_SKILLS_DIR`. They are intentionally kept out of this repository.

## Acknowledgements

- The chat and loading dot-matrix animation treatment is inspired by [icantcodefyi/dot-matrix-animations](https://github.com/icantcodefyi/dot-matrix-animations).

## Backlog

- Build a small evaluation set from real user questions, expected source pages, and refusal cases.
- Tune wiki retrieval with that evaluation set, especially acronym-heavy queries such as RDS.
- Add UI-level model switching and per-user ELM API key configuration.
- Explore Overleaf draft import for checklist runs; keep other external integrations out unless they become easy and necessary.

## Development AI Helpers

Mastra coding-agent skills may be installed locally under `.agents/skills/mastra` from `mastra-ai/skills`, but `.agents/` and `skills-lock.json` are intentionally ignored and should not be committed.

For live Mastra documentation lookup, Codex can use the Mastra MCP docs server:

```bash
codex mcp add mastra-docs -- npx -y @mastra/mcp-docs-server@latest
```

After adding or updating skills/MCP servers, restart Codex so the new tools are picked up.
