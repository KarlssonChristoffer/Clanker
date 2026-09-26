-- Slash-command registration state (written by discord-bot).
-- The bot hashes its command definitions and only calls Discord's bulk-overwrite endpoint when the
-- hash for a scope ('global' or 'guild:<id>') changed since the last successful registration.

CREATE TABLE IF NOT EXISTS bot.command_registrations (
  application_id   TEXT        NOT NULL,
  scope            TEXT        NOT NULL,
  definitions_hash TEXT        NOT NULL,
  command_count    INT         NOT NULL,
  registered_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (application_id, scope)
);

INSERT INTO public.schema_migrations (version)
SELECT '014_bot_command_registrations'
WHERE NOT EXISTS (SELECT 1 FROM public.schema_migrations WHERE version = '014_bot_command_registrations');
