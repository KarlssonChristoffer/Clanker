-- Bot architecture tables (written by discord-bot):
--   bot.scheduled_jobs   persistent job queue (reminders, raid pings, weekly posts); survives restarts
--   bot.guild_features   per-guild feature flags (/admin funktioner)
--   bot.channel_features per-channel opt-in for noisy features (e.g. Jev emoji reflexes)
--   bot.runtime_status   heartbeat from the single gateway owner (the bot); hub-api reads it for "live" views

-- ── Scheduled jobs ───────────────────────────────────────────────────────────
-- status: pending → running → done | failed | cancelled. Workers claim rows with FOR UPDATE SKIP LOCKED.
-- dedupe_key: at most one pending/running job per key (e.g. 'raid-ping:42'), so re-scheduling replaces it.

CREATE TABLE IF NOT EXISTS bot.scheduled_jobs (
  id           BIGSERIAL   PRIMARY KEY,
  guild_id     TEXT        NULL,
  kind         TEXT        NOT NULL,
  run_at       TIMESTAMPTZ NOT NULL,
  payload      JSONB       NOT NULL DEFAULT '{}'::jsonb,
  status       TEXT        NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'running', 'done', 'failed', 'cancelled')),
  attempts     INT         NOT NULL DEFAULT 0,
  max_attempts INT         NOT NULL DEFAULT 5,
  last_error   TEXT        NULL,
  dedupe_key   TEXT        NULL,
  locked_at    TIMESTAMPTZ NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at  TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_due
  ON bot.scheduled_jobs (run_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_guild_kind
  ON bot.scheduled_jobs (guild_id, kind, run_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_scheduled_jobs_active_dedupe
  ON bot.scheduled_jobs (dedupe_key)
  WHERE dedupe_key IS NOT NULL AND status IN ('pending', 'running');

-- ── Feature flags ────────────────────────────────────────────────────────────
-- A missing row means "use the default from the bot's feature registry".

CREATE TABLE IF NOT EXISTS bot.guild_features (
  guild_id   TEXT        NOT NULL,
  feature    TEXT        NOT NULL,
  enabled    BOOLEAN     NOT NULL,
  updated_by TEXT        NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (guild_id, feature)
);

CREATE TABLE IF NOT EXISTS bot.channel_features (
  guild_id   TEXT        NOT NULL,
  channel_id TEXT        NOT NULL,
  feature    TEXT        NOT NULL,
  enabled    BOOLEAN     NOT NULL,
  updated_by TEXT        NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (channel_id, feature)
);

CREATE INDEX IF NOT EXISTS idx_channel_features_guild ON bot.channel_features (guild_id, feature);

-- ── Runtime heartbeat ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS bot.runtime_status (
  instance          TEXT        PRIMARY KEY,
  discord_ready     BOOLEAN     NOT NULL DEFAULT FALSE,
  version           TEXT        NULL,
  guild_ids         TEXT[]      NOT NULL DEFAULT '{}',
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_event_at     TIMESTAMPTZ NULL
);

INSERT INTO public.schema_migrations (version)
SELECT '015_bot_scheduler_features'
WHERE NOT EXISTS (SELECT 1 FROM public.schema_migrations WHERE version = '015_bot_scheduler_features');
