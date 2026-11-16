CREATE TABLE IF NOT EXISTS scenarios (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, name text NOT NULL, version integer NOT NULL,
 checksum text NOT NULL, fixture_id text NOT NULL, owner_name text NOT NULL DEFAULT 'local', definition jsonb NOT NULL,
 UNIQUE(name,version)
);
CREATE TABLE IF NOT EXISTS scenario_steps (
 scenario_id bigint REFERENCES scenarios ON DELETE CASCADE, ordinal int NOT NULL, template jsonb NOT NULL,
 PRIMARY KEY(scenario_id,ordinal)
);
CREATE TABLE IF NOT EXISTS jobs (
 id uuid PRIMARY KEY, scenario_id bigint NOT NULL REFERENCES scenarios, candidate text NOT NULL,
 priority int NOT NULL, state text NOT NULL DEFAULT 'queued', attempts int NOT NULL DEFAULT 0,
 lease uuid, expires timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pending_jobs ON jobs(state,priority DESC,created_at);
CREATE TABLE IF NOT EXISTS runs (
 id uuid PRIMARY KEY REFERENCES jobs ON DELETE CASCADE, scenario_id bigint NOT NULL REFERENCES scenarios,
 baseline_commit text, candidate_commit text, status text NOT NULL, started_at timestamptz NOT NULL,
 completed_at timestamptz NOT NULL, report jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS step_results (
 run_id uuid REFERENCES runs ON DELETE CASCADE, ordinal int, environment text,
 status int, body jsonb, duration_ms double precision, PRIMARY KEY(run_id,ordinal,environment)
);
CREATE TABLE IF NOT EXISTS diffs (
 run_id uuid REFERENCES runs ON DELETE CASCADE, ordinal int, path text, reason text, before_value jsonb, after_value jsonb, severity text DEFAULT 'error'
);
CREATE TABLE IF NOT EXISTS artifacts (
 run_id uuid REFERENCES runs ON DELETE CASCADE, format text, object_key text UNIQUE, checksum text NOT NULL,
 content text NOT NULL, uploaded boolean NOT NULL DEFAULT false, PRIMARY KEY(run_id,format)
);
-- Older installations committed the artifacts in the same transaction as the run.
ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS created_at timestamptz;
UPDATE artifacts a SET created_at=r.completed_at
FROM runs r WHERE r.id=a.run_id AND a.created_at IS NULL;
ALTER TABLE artifacts ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE artifacts ALTER COLUMN created_at SET NOT NULL;
