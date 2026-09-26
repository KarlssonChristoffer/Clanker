-- WoW features and server setup (written by discord-bot):
--   bot.setup_bindings       blueprint key → Discord id (so re-runs find renamed channels/roles)
--   bot.setup_runs/_changes  change log per /setup run; "Ångra senaste setup" replays it backwards
--   bot.raid_events/_signups raid and dungeon sign-ups (/raid skapa)
--   bot.lfg_posts/_members   LFG posts parsed by Jev in #lfg
--   bot.wow_characters       /wow koppla, /wow karaktär, /roster
--   bot.temp_voice_channels  join-to-create and LFG voice channels (deleted when empty)

CREATE TABLE IF NOT EXISTS bot.setup_bindings (
  guild_id      TEXT        NOT NULL,
  blueprint_key TEXT        NOT NULL,
  kind          TEXT        NOT NULL,           -- category | text | forum | voice | role | message
  discord_id    TEXT        NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (guild_id, blueprint_key)
);

CREATE TABLE IF NOT EXISTS bot.setup_runs (
  id         BIGSERIAL   PRIMARY KEY,
  guild_id   TEXT        NOT NULL,
  blueprint  TEXT        NOT NULL,
  flavor     TEXT        NOT NULL,
  user_id    TEXT        NOT NULL,
  status     TEXT        NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done', 'failed', 'undone')),
  summary    JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  undone_at  TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_setup_runs_guild ON bot.setup_runs (guild_id, created_at DESC);

CREATE TABLE IF NOT EXISTS bot.setup_changes (
  id            BIGSERIAL   PRIMARY KEY,
  run_id        BIGINT      NOT NULL REFERENCES bot.setup_runs(id) ON DELETE CASCADE,
  seq           INT         NOT NULL,
  action        TEXT        NOT NULL,           -- create | move | permissions | edit | onboarding
  target_kind   TEXT        NOT NULL,
  target_id     TEXT        NOT NULL,
  blueprint_key TEXT        NULL,
  before        JSONB       NULL,
  after         JSONB       NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_setup_changes_run ON bot.setup_changes (run_id, seq);

CREATE TABLE IF NOT EXISTS bot.raid_events (
  id               BIGSERIAL   PRIMARY KEY,
  guild_id         TEXT        NOT NULL,
  channel_id       TEXT        NOT NULL,
  message_id       TEXT        NULL,
  kind             TEXT        NOT NULL DEFAULT 'raid' CHECK (kind IN ('raid', 'dungeon')),
  title            TEXT        NOT NULL,
  starts_at        TIMESTAMPTZ NOT NULL,
  size             INT         NOT NULL,
  created_by       TEXT        NOT NULL,
  discord_event_id TEXT        NULL,
  status           TEXT        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'started', 'cancelled')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_raid_events_guild_start ON bot.raid_events (guild_id, starts_at);

CREATE TABLE IF NOT EXISTS bot.raid_signups (
  event_id   BIGINT      NOT NULL REFERENCES bot.raid_events(id) ON DELETE CASCADE,
  user_id    TEXT        NOT NULL,
  status     TEXT        NOT NULL CHECK (status IN ('tank', 'healer', 'dps', 'maybe', 'bench')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (event_id, user_id)
);

CREATE TABLE IF NOT EXISTS bot.lfg_posts (
  id               BIGSERIAL   PRIMARY KEY,
  guild_id         TEXT        NOT NULL,
  channel_id       TEXT        NOT NULL,          -- forum thread or text channel
  source_message_id TEXT       NOT NULL UNIQUE,
  author_id        TEXT        NOT NULL,
  content_type     TEXT        NULL,
  key_level        INT         NULL,
  when_label       TEXT        NULL,
  starts_at        TIMESTAMPTZ NULL,
  confidence       DOUBLE PRECISION NULL,
  needs            JSONB       NOT NULL DEFAULT '{}'::jsonb,   -- {tank:1, healer:1, dps:3} still open
  status           TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'open', 'full', 'ignored')),
  message_id       TEXT        NULL,
  voice_channel_id TEXT        NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bot.lfg_members (
  post_id   BIGINT      NOT NULL REFERENCES bot.lfg_posts(id) ON DELETE CASCADE,
  user_id   TEXT        NOT NULL,
  role      TEXT        NOT NULL CHECK (role IN ('tank', 'healer', 'dps')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS bot.wow_characters (
  id          BIGSERIAL   PRIMARY KEY,
  guild_id    TEXT        NOT NULL,
  user_id     TEXT        NOT NULL,
  flavor      TEXT        NOT NULL,
  region      TEXT        NOT NULL,
  name        TEXT        NOT NULL,
  realm       TEXT        NOT NULL,
  realm_slug  TEXT        NOT NULL,
  class       TEXT        NULL,
  spec        TEXT        NULL,
  role        TEXT        NULL CHECK (role IS NULL OR role IN ('tank', 'healer', 'dps')),
  item_level  DOUBLE PRECISION NULL,
  mplus_score DOUBLE PRECISION NULL,
  source      TEXT        NOT NULL DEFAULT 'manual',   -- manual | blizzard | raiderio
  profile_url TEXT        NULL,
  is_main     BOOLEAN     NOT NULL DEFAULT TRUE,
  fetched_at  TIMESTAMPTZ NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_wow_characters_identity
  ON bot.wow_characters (guild_id, user_id, flavor, realm_slug, lower(name));
CREATE INDEX IF NOT EXISTS idx_wow_characters_guild ON bot.wow_characters (guild_id, flavor);

CREATE TABLE IF NOT EXISTS bot.temp_voice_channels (
  channel_id TEXT        PRIMARY KEY,
  guild_id   TEXT        NOT NULL,
  owner_id   TEXT        NOT NULL,
  kind       TEXT        NOT NULL DEFAULT 'join-to-create',   -- join-to-create | lfg
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.schema_migrations (version)
SELECT '017_bot_wow_setup'
WHERE NOT EXISTS (SELECT 1 FROM public.schema_migrations WHERE version = '017_bot_wow_setup');
