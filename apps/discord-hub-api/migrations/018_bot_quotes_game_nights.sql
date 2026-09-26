-- Social features (written by discord-bot, quotes also read by discord-hub-api):
--   bot.quotes            the quote book: 💬 reaction on a message saves it (one row per message)
--   bot.game_nights/rsvps /spelkväll with Kommer / Kanske / Nej

CREATE TABLE IF NOT EXISTS bot.quotes (
  id          BIGSERIAL   PRIMARY KEY,
  guild_id    TEXT        NOT NULL,
  channel_id  TEXT        NOT NULL,
  message_id  TEXT        NOT NULL UNIQUE,
  author_id   TEXT        NOT NULL,
  author_name TEXT        NOT NULL,
  content     TEXT        NOT NULL,
  saved_by    TEXT        NOT NULL,
  said_at     TIMESTAMPTZ NOT NULL,
  saved_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quotes_guild_saved ON bot.quotes (guild_id, saved_at DESC);

CREATE TABLE IF NOT EXISTS bot.game_nights (
  id         BIGSERIAL   PRIMARY KEY,
  guild_id   TEXT        NOT NULL,
  channel_id TEXT        NOT NULL,
  message_id TEXT        NULL,
  game       TEXT        NOT NULL,
  starts_at  TIMESTAMPTZ NOT NULL,
  created_by TEXT        NOT NULL,
  status     TEXT        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'started', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bot.game_night_rsvps (
  night_id   BIGINT      NOT NULL REFERENCES bot.game_nights(id) ON DELETE CASCADE,
  user_id    TEXT        NOT NULL,
  status     TEXT        NOT NULL CHECK (status IN ('yes', 'maybe', 'no')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (night_id, user_id)
);

INSERT INTO public.schema_migrations (version)
SELECT '018_bot_quotes_game_nights'
WHERE NOT EXISTS (SELECT 1 FROM public.schema_migrations WHERE version = '018_bot_quotes_game_nights');
