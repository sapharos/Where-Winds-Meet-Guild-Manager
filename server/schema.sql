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

-- What this set is expected to put on the results screen, as a fraction of the
-- war's best on each axis: { "damage": 0.6 } means a set that kills one target
-- at a time reaching 60% of the night's best damage has done as much as its
-- weapons allow, and is scored as full marks on that axis.
--
-- Sparse and empty by default, so a weapon nobody has tuned yet is measured
-- exactly as it is today and a new one costs nothing until somebody decides it
-- needs an allowance. Kept here rather than in the scoring code because the
-- game keeps adding weapons and the guild should not wait on a deploy to say
-- what they are for. Validated in weapons.js against the axes in impact.ts.
ALTER TABLE weapon_sets ADD COLUMN IF NOT EXISTS impact JSONB NOT NULL DEFAULT '{}'::jsonb;

-- What a member is actually wearing, one row per slot, read off the game's
-- Afinación screen.
--
-- One row per slot rather than a history: you wear one helm, and the question
-- being asked is always "what should I do next with this piece". updated_at is
-- enough to know how stale it is.
--
-- relayed is the piece carried up from an older set. The game freezes every
-- line on those, so it is not a detail -- it is the difference between a piece
-- with advice worth giving and a piece there is nothing to say about.
--
-- tune_ready_at is an absolute moment, converted on the way in from the days
-- the screen counts down ("puede ser reajustada una vez cada 5 día(s)" is five
-- days REMAINING, not a five-day period). Storing the deadline rather than the
-- countdown means a capture from last Tuesday still says something true today.
CREATE TABLE IF NOT EXISTS gear_pieces (
  id            TEXT PRIMARY KEY,
  guild_id      TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  player_id     TEXT NOT NULL,
  slot          TEXT NOT NULL,
  name          TEXT,
  level         INTEGER,
  relayed       BOOLEAN NOT NULL DEFAULT false,
  tune_ready_at TIMESTAMPTZ,
  -- Up to six lines, and seven when the sixth holds both a normal and an arena
  -- tuning. Each: { position, stat, value, unit, fill, committed, truncated,
  -- tuning, active }. JSONB because the game keeps adding attributes and a
  -- column per one would mean a migration every patch -- the same reason
  -- war_participants.stats is JSONB.
  lines         JSONB NOT NULL DEFAULT '[]'::jsonb,
  captured_at   TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (guild_id, player_id, slot),
  FOREIGN KEY (guild_id, player_id) REFERENCES players (guild_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS gear_pieces_owner_idx ON gear_pieces (guild_id, player_id);

-- How high each attribute can roll, learned rather than looked up.
--
-- The game draws a bar under every line showing that roll as a fraction of its
-- own maximum, so one reading gives the ceiling: value / fill. Two independent
-- pieces put Tasa Crítica at 7.40 and 7.39, which is why this is trusted at
-- all. Every capture the guild uploads sharpens it, and nobody has to find a
-- table on a wiki that goes stale at the next patch.
--
-- Keyed by level because a level 81 piece and a level 91 piece do not share a
-- ceiling. samples is kept so a figure resting on one blurry screenshot can be
-- told apart from one that thirty members agree on.
CREATE TABLE IF NOT EXISTS gear_stat_ceilings (
  guild_id   TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  stat       TEXT NOT NULL,
  level      INTEGER NOT NULL,
  ceiling    NUMERIC NOT NULL,
  samples    INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, stat, level)
);

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

-- Guild war, in three parts that build on each other.
--
-- A deployment is the standing line-up: who goes where, kept separately for
-- attack and defence because the same person is rarely wanted in both.
-- A strategy is a named target composition -- how many tanks, healers and dps
-- each lane should hold -- which is what makes rebalancing possible when half
-- the guild is missing. A war freezes a deployment at the moment it starts, so
-- the history says who actually fought rather than who is on the list today.

CREATE TABLE IF NOT EXISTS war_deployments (
  guild_id  TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  side      TEXT NOT NULL,
  lane      TEXT NOT NULL,
  player_id TEXT NOT NULL,
  position  INTEGER NOT NULL DEFAULT 0,
  -- One lane per side per member: being in two places at once is not a plan.
  PRIMARY KEY (guild_id, side, player_id),
  FOREIGN KEY (guild_id, player_id) REFERENCES players (guild_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS war_deployments_lane_idx ON war_deployments (guild_id, side, lane);

-- Which tactical units a deployed member belongs to. Units cut across the lanes
-- -- an escort party takes people from all three -- so this is beside the lane
-- and not instead of it, and one person can hold more than one job at once.
-- Bare ids on purpose: units live inside a strategy, so the reference has to
-- survive the strategy being edited or deleted, and a member whose unit no
-- longer exists simply reads as unassigned.
ALTER TABLE war_deployments ADD COLUMN IF NOT EXISTS unit_ids JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Carry over the single-unit column this replaced, then retire it. Guarded so
-- that running the schema again on an already-migrated database does nothing.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'war_deployments' AND column_name = 'unit_id'
  ) THEN
    UPDATE war_deployments
       SET unit_ids = jsonb_build_array(unit_id)
     WHERE unit_id IS NOT NULL AND unit_ids = '[]'::jsonb;
    ALTER TABLE war_deployments DROP COLUMN unit_id;
  END IF;
END $$;

-- Which build they are meant to bring. A bare id for the same reason: builds
-- are edited and deleted by their owner, and a plan naming one that is gone
-- should fall back to whatever they usually play, not break the board.
ALTER TABLE war_deployments ADD COLUMN IF NOT EXISTS build_id TEXT;

-- Who speaks for the lane. A flag on the deployment rather than a table of its
-- own: leading here is a property of being fielded, and leaves the board with
-- the member. Several per lane are allowed on purpose -- a lane with two
-- shot-callers is the guild's business, not the schema's.
ALTER TABLE war_deployments ADD COLUMN IF NOT EXISTS is_lane_leader BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS war_strategies (
  id          TEXT PRIMARY KEY,
  guild_id    TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  side        TEXT NOT NULL,
  name        TEXT NOT NULL,
  -- { left: { tank, healer, dps }, center: {...}, right: {...} }
  composition JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS war_strategies_side_idx ON war_strategies (guild_id, side);

-- The tactical units a strategy calls for: [{ id, name, icon, color, tank,
-- healer, dps, notes }]. They belong to the strategy rather than to the guild
-- because a plan is exactly where "we need an escort party of five" is decided.
ALTER TABLE war_strategies ADD COLUMN IF NOT EXISTS units JSONB NOT NULL DEFAULT '[]'::jsonb;

-- A saved line-up: the deployment of one side, photographed under a name so it
-- can be fielded again. A snapshot and not live rows, because that is what
-- "save for later" means -- the roster will drift underneath it, and applying
-- one deals with the drift then, not now.
--
-- members: [{ playerId, lane, unitIds, buildId, position }]. Bare player ids
-- on purpose, like unit_ids and build_id above: a member who has left simply
-- fails to come back when the line-up is applied, and is reported rather than
-- resurrected.
CREATE TABLE IF NOT EXISTS war_saved_lineups (
  id         TEXT PRIMARY KEY,
  guild_id   TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  side       TEXT NOT NULL,
  name       TEXT NOT NULL,
  members    JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS war_saved_lineups_side_idx ON war_saved_lineups (guild_id, side);

CREATE TABLE IF NOT EXISTS wars (
  id         TEXT PRIMARY KEY,
  guild_id   TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at   TIMESTAMPTZ,
  outcome    TEXT,
  notes      TEXT,
  -- The results screenshot, kept until it has been read. Small enough to sit
  -- inline, and this deployment has no file storage on purpose.
  result_image TEXT
);

CREATE INDEX IF NOT EXISTS wars_recent_idx ON wars (guild_id, started_at DESC);

-- Who fought, where, and what they contributed. Written when a war starts,
-- from the deployment as it stood, and never rewritten afterwards: the point
-- of a record is that it says what happened, not what the plan is now.
-- The plans both sides were arranged against, copied whole rather than
-- referenced: a strategy goes on being edited after the war, and a record of
-- what happened must not change with it.
ALTER TABLE wars ADD COLUMN IF NOT EXISTS plans JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Liga, ranked o un reto concertado contra un gremio concreto. Decidido al
-- iniciar la guerra, que es cuando quien la organiza ya lo sabe. Validado en
-- el servidor (MATCH_TYPES en war.js) en vez de con una restricción aquí,
-- igual que side y lane.
ALTER TABLE wars ADD COLUMN IF NOT EXISTS match_type TEXT NOT NULL DEFAULT 'custom';

CREATE TABLE IF NOT EXISTS war_participants (
  war_id       TEXT NOT NULL REFERENCES wars(id) ON DELETE CASCADE,
  player_id    TEXT NOT NULL,
  side         TEXT NOT NULL,
  lane         TEXT NOT NULL,
  contribution INTEGER,
  PRIMARY KEY (war_id, player_id)
);

CREATE INDEX IF NOT EXISTS war_participants_player_idx ON war_participants (player_id);

-- What they were sent to do and what they brought, frozen with the rest.
ALTER TABLE war_participants ADD COLUMN IF NOT EXISTS unit_ids JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE war_participants ADD COLUMN IF NOT EXISTS build_id TEXT;

-- What they did: { damage, healing, kills, deaths, ... }. Open-ended because
-- the results screen reports more than anyone thought to name in advance, and a
-- column per figure would mean a migration every time the game adds one.
ALTER TABLE war_participants ADD COLUMN IF NOT EXISTS stats JSONB NOT NULL DEFAULT '{}'::jsonb;

-- The results screens, pasted in after the fight. More than one because the
-- game shows them a page at a time, and kept whole so they can be read again
-- when the reading turns out to be wrong.
CREATE TABLE IF NOT EXISTS war_images (
  id          TEXT PRIMARY KEY,
  war_id      TEXT NOT NULL REFERENCES wars(id) ON DELETE CASCADE,
  image       TEXT NOT NULL,
  caption     TEXT,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS war_images_war_idx ON war_images (war_id, uploaded_at);

-- A set: eight pieces built together, for one path, with one of your builds.
--
-- Gear used to be one row per slot per member, which quietly asserted that a
-- member has one helm. They do not -- they have the set they take to guild war
-- and the set they farm in, and the same piece is a keeper in one and a wasted
-- slot in the other. Worse, without knowing what a set is *for*, every one of
-- the game's forty-six attributes is equally plausible on every line, so there
-- was nothing to check a screenshot's reading against.
--
-- spec is one of the nine paths, an id from services/gearCatalog.ts. It is what
-- turns the attribute fields from free text into closed dropdowns, which is the
-- whole reason this table exists.
CREATE TABLE IF NOT EXISTS gear_sets (
  id         TEXT PRIMARY KEY,
  guild_id   TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  player_id  TEXT NOT NULL,
  -- Which build in the member's profile this set is for. Nullable and ON DELETE
  -- SET NULL by hand in builds.js rather than by constraint: deleting a build
  -- must not take the record of eight pieces down with it.
  build_id   TEXT,
  name       TEXT NOT NULL,
  spec       TEXT NOT NULL,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (guild_id, player_id) REFERENCES players (guild_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS gear_sets_owner_idx ON gear_sets (guild_id, player_id);

ALTER TABLE gear_pieces ADD COLUMN IF NOT EXISTS set_id TEXT REFERENCES gear_sets(id) ON DELETE CASCADE;

-- Everything already recorded belongs to a set that did not exist when it was
-- saved. One per member who has any pieces at all, named for what it is and
-- left without a path -- nobody can be told which of the nine they were aiming
-- at, and inventing one would put wrong recommendations in front of them.
-- Their first visit picks it, and until then the set opens with the path
-- selector waiting.
INSERT INTO gear_sets (id, guild_id, player_id, build_id, name, spec, is_primary)
SELECT DISTINCT 'set-legacy-' || p.guild_id || '-' || p.player_id, p.guild_id, p.player_id,
       NULL, 'Mi equipo', '', true
  FROM gear_pieces p
 WHERE p.set_id IS NULL
   AND NOT EXISTS (SELECT 1 FROM gear_sets s WHERE s.guild_id = p.guild_id AND s.player_id = p.player_id);

UPDATE gear_pieces p
   SET set_id = s.id
  FROM gear_sets s
 WHERE p.set_id IS NULL AND s.guild_id = p.guild_id AND s.player_id = p.player_id AND s.is_primary;

-- One piece per slot per set, replacing one piece per slot per member. The old
-- constraint has to go first or the second set anybody builds cannot hold a
-- helm.
ALTER TABLE gear_pieces DROP CONSTRAINT IF EXISTS gear_pieces_guild_id_player_id_slot_key;
CREATE UNIQUE INDEX IF NOT EXISTS gear_pieces_set_slot_idx ON gear_pieces (set_id, slot);

-- Corrected Spanish names for the attribute catalogue.
--
-- The catalogue's keys are the English names from the analyzer, which are the
-- only complete list published. The Spanish shown next to them is fifteen names
-- read off real screenshots and about fifty translations that are mine. Those
-- fifty are good enough to match a screenshot and to recognise on a screen, and
-- some of them are certainly not what the game prints.
--
-- Rather than pretend otherwise, they are correctable, and a correction lands
-- here. It reaches both the label and the screenshot matcher -- correcting only
-- the display would leave a name that goes on failing to match forever, which
-- is the more annoying half of being wrong.
CREATE TABLE IF NOT EXISTS gear_stat_labels (
  guild_id   TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  -- The catalogue's English name, verbatim. Not folded: this is a pointer into
  -- a list in the source, not a key readings are grouped by.
  stat_key   TEXT NOT NULL,
  label      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, stat_key)
);

-- Now that every piece has been attached to one. Required rather than merely
-- backfilled because saveGearPiece infers its ON CONFLICT target from the index
-- above, and a nullable column there is a slot a piece could quietly fall
-- through: a NULL never conflicts, so the same helm would insert twice.
ALTER TABLE gear_pieces ALTER COLUMN set_id SET NOT NULL;

-- ---------------------------------------------------------------------------
-- La agenda: qué hay programado y quién va
--
-- Un evento es una ocasión concreta con fecha; la respuesta es de un miembro,
-- no de un mensaje de Discord. Eso último es la decisión que sostiene todo lo
-- demás: la web y el bot escriben en la misma fila, así que quien contesta en
-- uno lo ve contestado en el otro, y nadie tiene que preguntarse cuál de los
-- dos manda.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS guild_events (
  id           TEXT NOT NULL,
  guild_id     TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  -- 'war' | 'practice' | 'pve' | 'casual'. El tipo decide qué se pregunta:
  -- sólo la guerra de gremio pide además a cuántas partidas se llega.
  kind         TEXT NOT NULL,
  title        TEXT NOT NULL,
  -- Instante absoluto. La hora local -- 7:30 pm en Colombia -- se compone al
  -- pintarla, en el huso de quien mira: el gremio no está todo en el mismo.
  starts_at    TIMESTAMPTZ NOT NULL,
  minutes      INTEGER NOT NULL DEFAULT 60,
  -- Cuántas partidas caben esa noche. Sólo en las guerras; en lo demás, NULL.
  rounds       INTEGER,
  notes        TEXT,
  -- Cuándo se puede contestar. Fuera de esa ventana la encuesta se lee pero no
  -- se toca, que es lo que hace que una lista cerrada siga siendo la que se
  -- usó para armar la formación.
  opens_at     TIMESTAMPTZ,
  closes_at    TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_by   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, id)
);

CREATE INDEX IF NOT EXISTS guild_events_when_idx ON guild_events (guild_id, starts_at DESC);

CREATE TABLE IF NOT EXISTS event_responses (
  guild_id    TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  event_id    TEXT NOT NULL,
  player_id   TEXT NOT NULL,
  -- 'yes' | 'no' | 'maybe'. «Tal vez» existe porque la incertidumbre es el
  -- estado real de mucha gente el lunes, y obligar a mentir con un sí o un no
  -- convierte la encuesta en algo que hay que volver a preguntar por voz.
  answer      TEXT NOT NULL,
  -- A cuántas partidas llega, cuando el evento las cuenta y la respuesta es sí.
  rounds      INTEGER,
  note        TEXT,
  -- Quién la escribió, cuando no fue el propio miembro: un oficial puede
  -- contestar por quien no entra ni a la web ni a Discord, y esa diferencia
  -- tiene que quedar visible en vez de pasar por una confirmación suya.
  answered_by TEXT,
  source      TEXT NOT NULL DEFAULT 'web',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, event_id, player_id)
);

-- Un permiso nuevo no existe en la matriz de un gremio que ya la tenía
-- decidida, así que al desplegar esto nadie podría programar nada hasta ir a
-- marcarlo a mano. Se siembra una vez, a los roles que ya llevan la guerra, y
-- el marcador impide que vuelva a aparecer si alguien decide quitarlo.
INSERT INTO role_permissions (guild_id, role, permission)
SELECT DISTINCT guild_id, role, 'events.manage' FROM role_permissions
 WHERE permission = 'war.edit'
   AND NOT EXISTS (SELECT 1 FROM app_settings WHERE key = 'seeded:events.manage')
ON CONFLICT DO NOTHING;

INSERT INTO app_settings (key, value) VALUES ('seeded:events.manage', 'true')
  ON CONFLICT (key) DO NOTHING;

-- Dónde quedó publicada la encuesta, para poder reescribir ese mensaje en vez
-- de mandar otro cada vez que alguien contesta. Nullable: un evento puede vivir
-- sólo en la web, y el bot puede no estar configurado.
ALTER TABLE guild_events ADD COLUMN IF NOT EXISTS discord_channel_id TEXT;
ALTER TABLE guild_events ADD COLUMN IF NOT EXISTS discord_message_id TEXT;

-- ---------------------------------------------------------------------------
-- Las series: lo que se repite cada semana
--
-- Guardan la hora de pared y su zona, no un instante. «Los sábados a las 7:30
-- de Colombia» tiene que seguir queriendo decir lo mismo dentro de seis meses,
-- y un instante se desfasa en cuanto una zona cambia de hora. Colombia no la
-- cambia; la regla no puede depender de eso.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS event_series (
  id           TEXT NOT NULL,
  guild_id     TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,
  title        TEXT NOT NULL,
  -- 0 = domingo … 6 = sábado, como los cuenta JavaScript.
  weekday      SMALLINT NOT NULL,
  time_local   TEXT NOT NULL,
  timezone     TEXT NOT NULL DEFAULT 'America/Bogota',
  minutes      INTEGER NOT NULL DEFAULT 150,
  rounds       INTEGER,
  notes        TEXT,
  -- La ventana, dicha en relación al evento: «se abre cinco días antes a las
  -- 00:00» y «se cierra el mismo día a las 12:00». Relativo y no por día de la
  -- semana, para que la misma regla valga para cualquier evento.
  opens_days_before  INTEGER NOT NULL DEFAULT 5,
  opens_time         TEXT    NOT NULL DEFAULT '00:00',
  closes_days_before INTEGER NOT NULL DEFAULT 0,
  closes_time        TEXT    NOT NULL DEFAULT '12:00',
  -- Si el bot publica la encuesta solo al abrirse.
  auto_publish BOOLEAN NOT NULL DEFAULT true,
  active       BOOLEAN NOT NULL DEFAULT true,
  PRIMARY KEY (guild_id, id)
);

ALTER TABLE guild_events ADD COLUMN IF NOT EXISTS series_id   TEXT;
ALTER TABLE guild_events ADD COLUMN IF NOT EXISTS reminded_at TIMESTAMPTZ;

-- Una ocasión por serie e instante. Es lo que deja que el programador pase cada
-- cinco minutos, y que el arranque se repita, sin convocar dos veces el sábado.
CREATE UNIQUE INDEX IF NOT EXISTS guild_events_series_idx
  ON guild_events (guild_id, series_id, starts_at) WHERE series_id IS NOT NULL;

-- Las dos guerras de la semana se siembran desde `agenda.js` y no aquí: este
-- archivo corre antes de que exista la fila del gremio a la que apuntaría la
-- clave ajena, y además no sustituye el GUILD_ID.

-- `roster.uid` es nuevo, y sin sembrarlo un gremio con su matriz ya decidida se
-- quedaría sin nadie que pueda corregir un UID. Se le da a quien ya edita el
-- roster -- que por defecto es de sublíder hacia arriba -- una sola vez, con su
-- marcador para que no vuelva si se decide quitarlo.
INSERT INTO role_permissions (guild_id, role, permission)
SELECT DISTINCT guild_id, role, 'roster.uid' FROM role_permissions
 WHERE permission = 'roster.edit'
   AND NOT EXISTS (SELECT 1 FROM app_settings WHERE key = 'seeded:roster.uid')
ON CONFLICT DO NOTHING;

INSERT INTO app_settings (key, value) VALUES ('seeded:roster.uid', 'true')
  ON CONFLICT (key) DO NOTHING;

-- Quién puede contestar la encuesta de un evento: una lista de roles del
-- sistema de usuarios. Vacía significa todo el gremio, que es lo que había
-- antes y lo que sigue valiendo para lo que no se restrinja.
ALTER TABLE guild_events ADD COLUMN IF NOT EXISTS allowed_roles JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE event_series ADD COLUMN IF NOT EXISTS allowed_roles JSONB NOT NULL DEFAULT '[]'::jsonb;

-- `rounds` se retira: la guerra se contesta con un sí o un no, sin decir a
-- cuántas partidas se llega. Las columnas se quedan y no se borran -- una
-- columna borrada no se puede recuperar, y ahí están las respuestas de las
-- semanas que sí lo preguntaron. Dejan de leerse y de escribirse, nada más.
