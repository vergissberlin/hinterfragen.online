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

CREATE TABLE IF NOT EXISTS contribution_keys (
  id uuid PRIMARY KEY,
  label text NOT NULL,
  key_hash text UNIQUE NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS contribution_daily_quota (
  key_id uuid NOT NULL REFERENCES contribution_keys(id),
  day date NOT NULL,
  count integer NOT NULL CHECK(count BETWEEN 1 AND 30),
  PRIMARY KEY(key_id,day)
);
CREATE TABLE IF NOT EXISTS contributions (
  id uuid PRIMARY KEY,
  key_id uuid NOT NULL REFERENCES contribution_keys(id),
  video_id varchar(11) NOT NULL,
  body jsonb NOT NULL,
  body_digest text NOT NULL,
  status text NOT NULL DEFAULT 'review' CHECK(status IN ('review','rejected','adopted')),
  review_note text,
  candidate_id uuid REFERENCES candidates(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS contributions_created ON contributions(created_at);

-- Application sign-in identities are separate from social publication accounts.
CREATE TABLE IF NOT EXISTS login_identities (
  provider text NOT NULL,
  subject text NOT NULL,
  key_id uuid NOT NULL REFERENCES contribution_keys(id),
  PRIMARY KEY(provider,subject)
);
CREATE TABLE IF NOT EXISTS login_sessions (
  token_hash text PRIMARY KEY,
  key_id uuid NOT NULL REFERENCES contribution_keys(id),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS login_flows (
  id uuid PRIMARY KEY,
  state_hash text UNIQUE NOT NULL,
  browser_hash text NOT NULL,
  nonce text NOT NULL,
  google_verifier text,
  redirect_uri text NOT NULL,
  client_state text NOT NULL,
  challenge text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  code_hash text UNIQUE,
  key_id uuid REFERENCES contribution_keys(id),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS login_flows_expiry ON login_flows(expires_at);
CREATE INDEX IF NOT EXISTS login_sessions_expiry ON login_sessions(expires_at);

ALTER TABLE contributions ADD COLUMN IF NOT EXISTS ai_checked_at timestamptz;
ALTER TABLE contributions ADD COLUMN IF NOT EXISTS ai_reason text;
ALTER TABLE contributions ADD COLUMN IF NOT EXISTS review_provenance jsonb;
-- All adoptions before this migration were exclusively manual/editorial.
UPDATE contributions SET review_provenance='{"kind":"editorial"}'::jsonb WHERE status='adopted' AND review_provenance IS NULL;
