/** Append migrations; never expire live rollups or installation identities. */
export const telemetryMigrations = [
  {
    version: 1,
    sql: `
  CREATE TABLE installs (
    install_id uuid PRIMARY KEY,
    first_reported_day date NOT NULL
  );
  CREATE TABLE install_days (
    install_id uuid NOT NULL,
    day date NOT NULL,
    app_version text NOT NULL,
    os text NOT NULL CHECK (os IN ('macos', 'windows', 'linux', 'unknown')),
    received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (install_id, day)
  );
  CREATE INDEX install_days_day ON install_days(day);
  CREATE TABLE usage_daily (
    install_id uuid NOT NULL,
    day date NOT NULL,
    provider text NOT NULL CHECK (provider IN ('codex', 'claude', 'antigravity')),
    model text NOT NULL,
    turns bigint NOT NULL CHECK (turns BETWEEN 0 AND 9007199254740991),
    input_tokens bigint CHECK (input_tokens BETWEEN 0 AND 9007199254740991),
    cached_input_tokens bigint CHECK (cached_input_tokens BETWEEN 0 AND 9007199254740991),
    output_tokens bigint CHECK (output_tokens BETWEEN 0 AND 9007199254740991),
    estimated_cost_usd numeric CHECK (estimated_cost_usd >= 0 AND estimated_cost_usd <= 1000000000),
    CHECK (cached_input_tokens <= input_tokens),
    PRIMARY KEY (install_id, day, provider, model),
    FOREIGN KEY (install_id, day) REFERENCES install_days(install_id, day) ON DELETE CASCADE
  );
  CREATE INDEX usage_daily_day ON usage_daily(day);
  CREATE INDEX usage_daily_provider_model_day ON usage_daily(provider, model, day);
`,
  },
  {
    version: 2,
    sql: `CREATE INDEX installs_first_reported_day ON installs(first_reported_day);`,
  },
  {
    version: 3,
    sql: `ALTER TABLE usage_daily
      ADD COLUMN speed_turns bigint,
      ADD COLUMN speed_output_tokens bigint,
      ADD COLUMN generation_ms bigint,
      ADD COLUMN ttft_ms bigint,
      ADD COLUMN ttft_turns bigint,
      ADD CONSTRAINT performance_samples CHECK (
        (speed_turns IS NULL AND speed_output_tokens IS NULL AND generation_ms IS NULL AND ttft_ms IS NULL AND ttft_turns IS NULL)
        OR (speed_turns IS NOT NULL AND speed_output_tokens IS NOT NULL AND generation_ms IS NOT NULL AND ttft_ms IS NOT NULL AND ttft_turns IS NOT NULL
          AND speed_turns BETWEEN 0 AND turns AND ttft_turns BETWEEN speed_turns AND turns
          AND speed_output_tokens BETWEEN 0 AND 9007199254740991 AND generation_ms BETWEEN 0 AND 9007199254740991 AND ttft_ms BETWEEN 0 AND 9007199254740991
          AND ((speed_turns=0 AND speed_output_tokens=0 AND generation_ms=0) OR (speed_turns>0 AND speed_output_tokens>0 AND generation_ms>0))
          AND (ttft_turns>0 OR ttft_ms=0))
      );`,
  },
  {
    version: 4,
    sql: `ALTER TABLE usage_daily
      ADD COLUMN service_tier text NOT NULL DEFAULT 'unknown'
        CHECK (service_tier IN ('standard','fast','ultrafast','flex','batch','scale','unknown'));
      ALTER TABLE usage_daily DROP CONSTRAINT usage_daily_pkey;
      ALTER TABLE usage_daily ADD PRIMARY KEY (install_id,day,provider,model,service_tier);`,
  },
  {
    version: 5,
    sql: `ALTER TABLE install_days ADD COLUMN reported_hours smallint[] NOT NULL DEFAULT '{}';
      ALTER TABLE usage_daily ADD COLUMN report_hour smallint NOT NULL DEFAULT -1 CHECK(report_hour BETWEEN -1 AND 23);
      ALTER TABLE usage_daily DROP CONSTRAINT usage_daily_pkey;
      ALTER TABLE usage_daily ADD PRIMARY KEY(install_id,day,report_hour,provider,model,service_tier);`,
  },
  {
    version: 6,
    sql: `ALTER TABLE installs ADD COLUMN first_reported_hour smallint CHECK(first_reported_hour BETWEEN 0 AND 23);`,
  },
  {
    version: 7,
    sql: `ALTER TABLE usage_daily
      ADD COLUMN measured_turns bigint CHECK (measured_turns BETWEEN 0 AND turns),
      ADD COLUMN cost_coverage text CHECK (cost_coverage IN ('complete','partial','unavailable')),
      ADD CONSTRAINT measured_token_coverage CHECK (measured_turns IS NULL OR measured_turns=0 OR
        (input_tokens IS NOT NULL AND cached_input_tokens IS NOT NULL AND output_tokens IS NOT NULL)),
      ADD CONSTRAINT measured_cost_coverage CHECK (cost_coverage IS NULL OR
        ((cost_coverage='unavailable') = (estimated_cost_usd IS NULL)));`,
  },
] as const;
