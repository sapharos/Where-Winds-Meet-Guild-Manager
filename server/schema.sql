-- Everything is scoped by guild_id so a single deployment can host more than
-- one guild once logins exist. Ids are supplied by the client (the UI already
-- generates them), so they are TEXT rather than generated keys.

CREATE TABLE IF NOT EXISTS guilds (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

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

ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled BOOLEAN NOT NULL DEFAULT false;

-- The account the guild was set up with. Administrators are peers except in one
-- respect: only this one may take the role away from another, so a fellow
-- administrator cannot quietly remove the person who appointed them.
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_root BOOLEAN NOT NULL DEFAULT false;

-- Deployments that predate the column: the first administrator created is the
-- one the guild was set up with.
UPDATE users u SET is_root = true
 WHERE u.role = 'admin'
   AND NOT EXISTS (SELECT 1 FROM users r WHERE r.guild_id = u.guild_id AND r.is_root)
   AND u.created_at = (SELECT min(created_at) FROM users m WHERE m.guild_id = u.guild_id AND m.role = 'admin');

-- Signing in with Discord instead of a password. The id is Discord's own and
-- never changes, unlike the username, which is why the id is what identifies.
ALTER TABLE users ADD COLUMN IF NOT EXISTS discord_id       TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS discord_username TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS users_discord_idx
  ON users (guild_id, discord_id) WHERE discord_id IS NOT NULL;

-- Somebody asking to be given a roster entry. Account numbers are visible to
-- every member in game, so claiming one proves nothing on its own -- a leader
-- decides. Until then this row is the whole of the request: no account exists.
CREATE TABLE IF NOT EXISTS registration_requests (
  id               TEXT PRIMARY KEY,
  guild_id         TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  discord_id       TEXT NOT NULL,
  discord_username TEXT NOT NULL,
  claimed_uid      TEXT NOT NULL,
  player_id        TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (guild_id, discord_id)
);

-- Which permissions each role holds. A row is a grant; no row is a denial.
-- Editable at runtime, which is why this is data rather than a constant.
CREATE TABLE IF NOT EXISTS role_permissions (
  guild_id   TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  role       TEXT NOT NULL,
  permission TEXT NOT NULL,
  PRIMARY KEY (guild_id, role, permission)
);

-- Internal key/value, currently just the signing secret so that sessions
-- survive a restart when none was supplied through the environment.
CREATE TABLE IF NOT EXISTS app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
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

-- The game's own account number for a member, shown in the social popup. It
-- cannot be changed, so it survives a rename, which no name-based match can.
ALTER TABLE players ADD COLUMN IF NOT EXISTS game_uid  TEXT;
ALTER TABLE players ADD COLUMN IF NOT EXISTS online_id TEXT;

-- The rank the game itself shows, kept verbatim. The interface maps it to a
-- rank it understands, but storing the original means a label we have not met
-- yet can be classified properly later without rescanning.
ALTER TABLE players ADD COLUMN IF NOT EXISTS game_position TEXT;

-- Who is fielded on war day. A leader's decision, like rank: never read from a
-- screenshot, and never cleared by a sweep.
ALTER TABLE players ADD COLUMN IF NOT EXISTS is_starter BOOLEAN NOT NULL DEFAULT false;

-- Which half of a guild war a member is fielded in: 'attack', 'defense', or
-- undecided. A leader's call, like the two above, and never read from a sweep.
ALTER TABLE players ADD COLUMN IF NOT EXISTS war_side TEXT;

-- Whether they are still in the guild. Someone who leaves is deactivated
-- rather than deleted: their scan history is what says whether taking them
-- back is a good idea, and deleting the row would take it with them.
ALTER TABLE players ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

CREATE UNIQUE INDEX IF NOT EXISTS players_game_uid_idx
  ON players (guild_id, game_uid) WHERE game_uid IS NOT NULL;

-- What the recogniser reads for a member, which is stable but not always the
-- real spelling: it has no diacritics, so Subâru always comes back as Subaru.
-- Confirming that once here is what stops every later scan from asking again.
-- Weaker than game_uid: a rename invalidates it, a uid never does.
CREATE TABLE IF NOT EXISTS player_aliases (
  guild_id   TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  alias      TEXT NOT NULL,
  player_id  TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, alias),
  FOREIGN KEY (guild_id, player_id) REFERENCES players (guild_id, id) ON DELETE CASCADE
);

-- One row per member per scan, never updated. Overwriting would answer "how is
-- this member doing now" while losing "is this member fading", which is the
-- question that actually decides who stays in the guild.
CREATE TABLE IF NOT EXISTS player_scans (
  id                    BIGSERIAL PRIMARY KEY,
  guild_id              TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  player_id             TEXT NOT NULL,
  scanned_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  position              TEXT,
  level                 INTEGER,
  sect                  TEXT,
  region                TEXT,
  language              TEXT,
  days_joined           INTEGER,
  week_activity         INTEGER,
  treasure_tokens_week  INTEGER,
  treasure_tokens_total INTEGER,
  weekly_clears         INTEGER,
  last_week_clears      INTEGER,
  highest_floor         INTEGER,
  league_participations INTEGER,
  ranked_participations INTEGER,
  duel_participations   INTEGER,
  martial_mastery       INTEGER,
  exploration_mastery   INTEGER,
  profession_mastery    INTEGER,
  FOREIGN KEY (guild_id, player_id) REFERENCES players (guild_id, id) ON DELETE CASCADE
);

-- The weapon sets a build can draw from. Kept as data rather than a constant
-- because the game adds weapons, and waiting on a code change to record what
-- the guild is already playing is the wrong way round. The icon holds either a
-- Font Awesome class or a small data URI, so an uploaded picture needs no file
-- storage and survives a redeploy like everything else here.
CREATE TABLE IF NOT EXISTS weapon_sets (
  id         TEXT PRIMARY KEY,
  guild_id   TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  weapons    JSONB NOT NULL DEFAULT '[]'::jsonb,
  color      TEXT NOT NULL DEFAULT '#f59e0b',
  icon       TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS weapon_sets_guild_idx ON weapon_sets (guild_id, sort_order);

-- A member carries several builds, and a build fills more than one role: a
-- weapon pair played as tank and healer at once is why a single combat role on
-- the roster was never enough. Never captured from the game -- these are chosen
-- by people, so a sweep must not touch them.
CREATE TABLE IF NOT EXISTS player_builds (
  id         TEXT PRIMARY KEY,
  guild_id   TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  player_id  TEXT NOT NULL,
  name       TEXT NOT NULL,
  weapons    JSONB NOT NULL DEFAULT '[]'::jsonb,
  roles      JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  notes      TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (guild_id, player_id) REFERENCES players (guild_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS player_builds_owner_idx ON player_builds (guild_id, player_id);

CREATE INDEX IF NOT EXISTS player_scans_history_idx ON player_scans (guild_id, player_id, scanned_at DESC);
CREATE INDEX IF NOT EXISTS players_guild_idx      ON players (guild_id);
CREATE INDEX IF NOT EXISTS ranks_guild_idx        ON ranks (guild_id);
CREATE INDEX IF NOT EXISTS war_sessions_guild_idx ON war_sessions (guild_id);
