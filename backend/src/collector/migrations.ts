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
] as const;
