CREATE TABLE IF NOT EXISTS app_sessions (
  token_hash TEXT PRIMARY KEY,
  user_data JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS app_sessions_expires_at_idx
  ON app_sessions (expires_at);

ALTER TABLE app_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deny_direct_client_access ON app_sessions;
CREATE POLICY deny_direct_client_access ON app_sessions
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
