CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS kb_gaps (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  question TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'wiki_qa',
  session_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9][a-z0-9._-]{1,62}[a-z0-9]$'),
  display_name TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('administrator', 'pi', 'organizer', 'member', 'viewer', 'service')),
  password_hash TEXT,
  password_reset_required BOOLEAN NOT NULL DEFAULT false,
  password_changed_at TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  auth_provider TEXT NOT NULL DEFAULT 'local',
  provisioning_status TEXT NOT NULL DEFAULT 'profile_only' CHECK (
    provisioning_status IN ('profile_only', 'invited', 'active', 'disabled')
  ),
  source TEXT NOT NULL DEFAULT 'manual',
  source_url TEXT,
  source_profile_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (email = '' OR email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  CHECK (provisioning_status <> 'active' OR email <> '' OR password_reset_required)
);

CREATE INDEX IF NOT EXISTS users_role_idx ON users (role);
CREATE INDEX IF NOT EXISTS users_provisioning_status_idx ON users (provisioning_status);
CREATE INDEX IF NOT EXISTS users_source_idx ON users (source);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS app_settings_updated_at_idx ON app_settings (updated_at DESC);

CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_time TIMESTAMPTZ NOT NULL DEFAULT now(),
  event_day DATE NOT NULL DEFAULT ((now() AT TIME ZONE 'Europe/London')::date),
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_username TEXT,
  actor_role TEXT,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL DEFAULT '',
  target_id TEXT,
  summary TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS audit_log_event_time_idx ON audit_log (event_time DESC);
CREATE INDEX IF NOT EXISTS audit_log_event_day_idx ON audit_log (event_day, event_time DESC);
CREATE INDEX IF NOT EXISTS audit_log_actor_idx ON audit_log (actor_user_id, event_time DESC);
CREATE INDEX IF NOT EXISTS audit_log_action_idx ON audit_log (action, event_time DESC);

CREATE TABLE IF NOT EXISTS project_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  owner_username TEXT NOT NULL,
  collaborator_usernames TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  track TEXT NOT NULL DEFAULT 'A' CHECK (track IN ('A', 'B')),
  stage INTEGER NOT NULL DEFAULT 1 CHECK (stage BETWEEN 1 AND 5),
  lifecycle TEXT NOT NULL DEFAULT 'active' CHECK (lifecycle IN ('active', 'paused', 'finished', 'archived')),
  status TEXT NOT NULL DEFAULT 'on_track' CHECK (status IN ('on_track', 'blocked', 'stale', 'needs_input')),
  stage_since DATE,
  last_update DATE,
  blocker TEXT,
  target TEXT,
  venue TEXT,
  submission_deadline DATE,
  watch_path TEXT,
  notes TEXT,
  archived_at TIMESTAMPTZ,
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES project_records(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'other',
  path TEXT,
  summary TEXT NOT NULL DEFAULT '',
  artifact_key TEXT NOT NULL,
  is_current BOOLEAN NOT NULL DEFAULT true,
  source_update_id UUID,
  uploaded_by_username TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS project_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES project_records(id) ON DELETE CASCADE,
  update_date DATE NOT NULL DEFAULT CURRENT_DATE,
  by_username TEXT NOT NULL,
  update_type TEXT NOT NULL DEFAULT 'progress' CHECK (update_type IN ('progress', 'note', 'decision', 'blocker', 'artifact')),
  text TEXT NOT NULL,
  artifact_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_update_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  update_id UUID NOT NULL REFERENCES project_updates(id) ON DELETE CASCADE,
  by_username TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS project_records_owner_idx ON project_records (owner_username);
CREATE UNIQUE INDEX IF NOT EXISTS project_records_owner_slug_idx ON project_records (lower(owner_username), slug);
CREATE INDEX IF NOT EXISTS project_records_track_idx ON project_records (track);
CREATE INDEX IF NOT EXISTS project_records_lifecycle_idx ON project_records (lifecycle);
CREATE INDEX IF NOT EXISTS project_updates_project_idx ON project_updates (project_id, update_date DESC);
CREATE INDEX IF NOT EXISTS project_artifacts_project_idx ON project_artifacts (project_id, is_current);

CREATE TABLE IF NOT EXISTS review_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_name TEXT,
  draft_name TEXT NOT NULL,
  target_venue TEXT,
  deadline TEXT,
  initiator TEXT,
  pi_or_senior_reviewer TEXT,
  cooperators TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  reviewer TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS review_check_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES review_runs(id) ON DELETE CASCADE,
  skill_name TEXT NOT NULL,
  skill_label TEXT NOT NULL,
  verdict TEXT NOT NULL CHECK (verdict IN ('CLEARED', 'CONDITIONAL', 'SLIDE')),
  report_markdown TEXT NOT NULL,
  result_json JSONB NOT NULL,
  signoff_status TEXT NOT NULL DEFAULT 'pending' CHECK (
    signoff_status IN ('pending', 'accepted', 'needs_revision', 'rejected')
  ),
  reviewer_note TEXT NOT NULL DEFAULT '',
  signed_off_by TEXT,
  signed_off_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, skill_name)
);

CREATE INDEX IF NOT EXISTS review_runs_created_at_idx ON review_runs (created_at DESC);
CREATE INDEX IF NOT EXISTS review_runs_project_name_idx ON review_runs (project_name);
CREATE INDEX IF NOT EXISTS review_check_results_run_id_idx ON review_check_results (run_id);
CREATE INDEX IF NOT EXISTS review_check_results_signoff_status_idx ON review_check_results (signoff_status);

CREATE TABLE IF NOT EXISTS chat_sessions (
  id TEXT PRIMARY KEY,
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'New chat',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_session_members (
  session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shared_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  membership_kind TEXT NOT NULL DEFAULT 'shared' CHECK (membership_kind IN ('owner', 'shared')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, user_id)
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  status TEXT CHECK (status IN ('answer', 'refusal')),
  sources JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'chat_mention' CHECK (type IN ('chat_mention')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_sessions_updated_at_idx ON chat_sessions (updated_at DESC);
CREATE INDEX IF NOT EXISTS chat_session_members_user_idx ON chat_session_members (user_id);
CREATE INDEX IF NOT EXISTS chat_messages_session_idx ON chat_messages (session_id, created_at);
CREATE INDEX IF NOT EXISTS chat_notifications_recipient_idx ON chat_notifications (recipient_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS chat_notifications_unread_idx ON chat_notifications (recipient_user_id) WHERE read_at IS NULL;
