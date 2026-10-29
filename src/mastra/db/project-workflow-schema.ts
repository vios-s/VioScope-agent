import { createPostgresClient } from './postgres';

export async function ensureProjectWorkflowTables() {
 const db=createPostgresClient();
 await db.pool.query(`CREATE TABLE IF NOT EXISTS project_research (
  project_id UUID PRIMARY KEY REFERENCES project_records(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL DEFAULT 0, profile JSONB NOT NULL DEFAULT '{}'::jsonb, history JSONB NOT NULL DEFAULT '[]'::jsonb
 );
 CREATE TABLE IF NOT EXISTS project_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), project_id UUID NOT NULL REFERENCES project_records(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL DEFAULT 0, is_current BOOLEAN NOT NULL DEFAULT true,
  plan JSONB NOT NULL, result JSONB NOT NULL DEFAULT '{}'::jsonb, history JSONB NOT NULL DEFAULT '[]'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
 );
 CREATE UNIQUE INDEX IF NOT EXISTS project_submission_current ON project_submissions(project_id) WHERE is_current;
 CREATE TABLE IF NOT EXISTS project_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), project_id UUID NOT NULL REFERENCES project_records(id) ON DELETE CASCADE,
  data JSONB NOT NULL, created_by TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
 );
 CREATE TABLE IF NOT EXISTS project_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), project_id UUID NOT NULL REFERENCES project_records(id) ON DELETE CASCADE,
  submission_id UUID REFERENCES project_submissions(id), data JSONB NOT NULL, decided_by TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
 );
 CREATE TABLE IF NOT EXISTS project_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), project_id UUID REFERENCES project_records(id) ON DELETE CASCADE,
  source_kind TEXT NOT NULL, source_id TEXT, revision INTEGER NOT NULL DEFAULT 0, data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
 );
 CREATE INDEX IF NOT EXISTS project_tasks_project ON project_tasks(project_id);
 CREATE TABLE IF NOT EXISTS meeting_task_imports(path TEXT PRIMARY KEY, imported_at TIMESTAMPTZ NOT NULL DEFAULT now());`);
}
