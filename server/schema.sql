-- Everything is scoped by guild_id so a single deployment can host more than
-- one guild once logins exist. Ids are supplied by the client (the UI already
-- generates them), so they are TEXT rather than generated keys.

CREATE TABLE IF NOT EXISTS guilds (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Not read by the app yet. It exists so that adding login later is a matter of
-- writing the endpoints, not migrating live guild data.
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  guild_id      TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  username      TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'member',
  player_id     TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (guild_id, username)
);

CREATE TABLE IF NOT EXISTS ranks (
  id       TEXT NOT NULL,
  guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  name     TEXT NOT NULL,
  color    TEXT NOT NULL,
  PRIMARY KEY (guild_id, id)
);

CREATE TABLE IF NOT EXISTS players (
  id       TEXT NOT NULL,
  guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  name     TEXT NOT NULL,
  role     TEXT NOT NULL,
  level    INTEGER NOT NULL,
  sect     TEXT NOT NULL,
  platform TEXT,
  status   TEXT NOT NULL,
  rank_id  TEXT,
  notes    TEXT,
  PRIMARY KEY (guild_id, id)
);

-- Assignments and tactical groups are always read and written as a whole set
-- per session, so they stay as JSONB instead of separate tables.
CREATE TABLE IF NOT EXISTS war_sessions (
  id               TEXT NOT NULL,
  guild_id         TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  date             TIMESTAMPTZ NOT NULL,
  assignments      JSONB NOT NULL DEFAULT '[]'::jsonb,
  tactical_groups  JSONB NOT NULL DEFAULT '[]'::jsonb,
  PRIMARY KEY (guild_id, id)
);

CREATE INDEX IF NOT EXISTS players_guild_idx      ON players (guild_id);
CREATE INDEX IF NOT EXISTS ranks_guild_idx        ON ranks (guild_id);
CREATE INDEX IF NOT EXISTS war_sessions_guild_idx ON war_sessions (guild_id);
