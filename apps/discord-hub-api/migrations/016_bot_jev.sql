-- Jev (TypeSafe) layer, written by discord-bot:
--   bot.jev_calls          one row per API call (stats for /jevstats: tokens, cost, latency, errors)
--   bot.jev_optout         users whose messages are never sent to Jev
--   bot.mindreader_matrix  cached P(yes | candidate, property) per model version for /tankeläsare

CREATE TABLE IF NOT EXISTS bot.jev_calls (
  id            BIGSERIAL   PRIMARY KEY,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  feature       TEXT        NOT NULL,
  guild_id      TEXT        NULL,
  model         TEXT        NULL,
  -- ok | http_error | network_error | timeout | breaker_open
  outcome       TEXT        NOT NULL,
  http_status   INT         NULL,
  attempts      INT         NOT NULL DEFAULT 1,
  question_count INT        NOT NULL DEFAULT 0,
  input_tokens  INT         NOT NULL DEFAULT 0,
  output_tokens INT         NOT NULL DEFAULT 0,
  latency_ms    INT         NOT NULL DEFAULT 0,
  request_id    TEXT        NULL,
  error         TEXT        NULL
);

CREATE INDEX IF NOT EXISTS idx_jev_calls_created ON bot.jev_calls (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jev_calls_feature_created ON bot.jev_calls (feature, created_at DESC);

CREATE TABLE IF NOT EXISTS bot.jev_optout (
  user_id    TEXT        PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bot.mindreader_matrix (
  model        TEXT             NOT NULL,
  candidate_id TEXT             NOT NULL,
  property_id  TEXT             NOT NULL,
  p_yes        DOUBLE PRECISION NOT NULL CHECK (p_yes >= 0 AND p_yes <= 1),
  computed_at  TIMESTAMPTZ      NOT NULL DEFAULT now(),

  PRIMARY KEY (model, candidate_id, property_id)
);

INSERT INTO public.schema_migrations (version)
SELECT '016_bot_jev'
WHERE NOT EXISTS (SELECT 1 FROM public.schema_migrations WHERE version = '016_bot_jev');
