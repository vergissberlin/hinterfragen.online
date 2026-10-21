CREATE TABLE IF NOT EXISTS candidates (
  id uuid PRIMARY KEY,
  video_id varchar(11) UNIQUE NOT NULL,
  title text NOT NULL,
  channel text NOT NULL,
  channel_id text NOT NULL,
  status text NOT NULL DEFAULT 'discovered' CHECK (status IN ('discovered','ready','review','published','withdrawn','expired')),
  body jsonb,
  analysis jsonb,
  body_digest text,
  reason text,
  checked_at timestamptz,
  source_updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS analysis_runs (
  run_id uuid PRIMARY KEY,
  candidate_id uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  model_digest text NOT NULL,
  prompt_digest text NOT NULL,
  duration_ms bigint NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS daily_events (
  day date NOT NULL,
  post_id uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('original_open','question_copy')),
  count bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (day, post_id, event_type)
);
CREATE TABLE IF NOT EXISTS system_flags (
  name text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false
);
INSERT INTO system_flags(name,enabled) VALUES ('attack_mode',false) ON CONFLICT DO NOTHING;
INSERT INTO system_flags(name,enabled) VALUES ('publication_paused',true) ON CONFLICT DO NOTHING;
CREATE INDEX IF NOT EXISTS candidates_status ON candidates(status);
CREATE INDEX IF NOT EXISTS analysis_runs_created ON analysis_runs(created_at);

ALTER TABLE candidates DROP CONSTRAINT IF EXISTS candidates_video_id_key;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS source_key text;
UPDATE candidates SET source_key='video:' || video_id WHERE source_key IS NULL;
ALTER TABLE candidates ALTER COLUMN source_key SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS candidates_source_key ON candidates(source_key);
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS source_author jsonb;
