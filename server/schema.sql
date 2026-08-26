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

-- Si la guerra se reconstruyó a partir de sus pantallazos en vez de haberse
-- arbitrado en vivo. Se marca porque cambia lo que se puede esperar del
-- registro: no hay plan, las líneas pueden faltar y las cifras las tecleó o
-- las leyó alguien meses después. Quien mire el historial merece saberlo.
ALTER TABLE wars ADD COLUMN IF NOT EXISTS imported BOOLEAN NOT NULL DEFAULT false;

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

-- Los cambios a mitad de guerra: cuándo dejó el sitio quien lo dejó y cuándo lo
-- ocupó quien entró. Nulo en los dos es lo corriente -- casi todo el mundo
-- empieza y termina la guerra -- y por eso son marcas y no una tabla aparte.
--
-- Quien se sale sigue siendo participante en vez de borrarse: peleó veinte
-- minutos, sus cifras salen en el pantallazo final y su línea estuvo cubierta
-- por él hasta que dejó de estarlo. Borrarlo sería decir que no estuvo.
ALTER TABLE war_participants ADD COLUMN IF NOT EXISTS left_at TIMESTAMPTZ;
ALTER TABLE war_participants ADD COLUMN IF NOT EXISTS joined_at TIMESTAMPTZ;

-- La línea deja de ser obligatoria por las guerras que se cargan desde el
-- pantallazo final: la pantalla de resultados dice quién peleó y cuánto hizo,
-- pero no dónde estaba, y meses después nadie lo recuerda. Nulo es «no consta»,
-- que es la verdad, y vale más que repartir a treinta personas al azar entre
-- tres líneas para satisfacer una restricción. El puntaje de impacto no lee la
-- línea -- sólo el bando -- así que una guerra sin líneas se puntúa entera.
ALTER TABLE war_participants ALTER COLUMN lane DROP NOT NULL;

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

-- Quién puede contestar, tomado dos: los roles del servidor de Discord.
--
-- Es lo que el gremio ya usa a diario para decir quién es qué -- «Guerra A»,
-- «Veterano» -- y tiene el grano que hace falta para una convocatoria, que los
-- cinco rangos del sistema de usuarios no dan. Se guardan los ids y no los
-- nombres: un rol renombrado en Discord sigue siendo el mismo rol, y quien lo
-- lea escribe `<@&id>` y deja que Discord ponga el nombre y el color de ahora.
--
-- `allowed_roles` (los rangos) queda sin usar por el mismo motivo que `rounds`:
-- las columnas no se borran. Vacía en todas las filas desde el día que se
-- cambió, y las convocatorias que la tuvieran puesta pasan a estar abiertas a
-- todo el gremio, que es lo que dice una lista vacía.
ALTER TABLE guild_events ADD COLUMN IF NOT EXISTS allowed_discord_roles JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE event_series ADD COLUMN IF NOT EXISTS allowed_discord_roles JSONB NOT NULL DEFAULT '[]'::jsonb;

-- `events.reset` -- reiniciar una encuesta -- no se siembra aquí a mano: le vale
-- el mecanismo general de `ensurePermissions`, que a cada permiso nuevo del
-- catálogo le aplica una vez lo que diga DEFAULT_PERMISSIONS. Ahí ya está en
-- admin, líder y sublíder, y fuera de oficial.
--
-- `roster.uid` sí necesitó siembra propia porque era un matiz de `roster.edit`
-- y había que dárselo a quien ya lo tuviera aunque hubiera cambiado la matriz.
-- Este es al revés: un oficial programa la guerra del sábado y no por eso puede
-- tirar las cincuenta respuestas que ya lleva.

-- Cómo se recuerda una convocatoria a quien no ha contestado.
--
-- `reminder_mode`: 'channel' escribe en el canal de la agenda mencionando a
-- quien falta -- es lo que se venía haciendo, y por eso es el valor de partida
-- de todo lo ya guardado. 'dm' se lo manda por privado a cada uno. 'none' no
-- recuerda nada.
--
-- `reminder_every_days` y `reminder_time`: repetirlo cada tantos días a una
-- hora de pared. Nulos, se mantiene el aviso de siempre -- uno solo, seis horas
-- antes de que cierre -- que es lo que sigue queriendo la mayoría de eventos.
ALTER TABLE guild_events ADD COLUMN IF NOT EXISTS reminder_mode TEXT NOT NULL DEFAULT 'channel';
ALTER TABLE guild_events ADD COLUMN IF NOT EXISTS reminder_every_days INT;
ALTER TABLE guild_events ADD COLUMN IF NOT EXISTS reminder_time TEXT;

ALTER TABLE event_series ADD COLUMN IF NOT EXISTS reminder_mode TEXT NOT NULL DEFAULT 'channel';
ALTER TABLE event_series ADD COLUMN IF NOT EXISTS reminder_every_days INT;
ALTER TABLE event_series ADD COLUMN IF NOT EXISTS reminder_time TEXT;

-- Las grabaciones de una guerra, subidas por quien la jugó. Ver docs/VODS.md.
--
-- Los bytes no están aquí ni en este contenedor: viven en el Synology, montado
-- en /mnt/vods. Esta tabla guarda dónde y en qué estado, y es deliberadamente
-- la única que sabe la ruta -- si algún día el origen se muda a B2, se cambia
-- aquí y en nginx, no en la aplicación.
--
-- `estado`: pendiente -> procesando -> listo -> aprobado, o rechazado. Nada se
-- ve hasta que alguien con war.vod.approve lo mira, que es lo que impide que
-- esto se llene de grabaciones que no son de la guerra. Validado en el servidor
-- y no con una restricción aquí, igual que side, lane y match_type.
--
-- `offset_ms`: milisegundos desde EL ARRANQUE DE LA PARTIDA hasta el primer
-- fotograma. NEGATIVO si empezó a grabar antes -- lo normal, porque casi todos
-- graban desde la preparación, que en esta escala es tiempo negativo -- y
-- positivo si se acordó de darle a grabar a mitad. Es el número del que depende
-- el multistream: sin él cuatro vídeos del mismo momento no se pueden poner uno
-- al lado del otro. El cero estuvo en el comienzo de la preparación hasta que
-- se movió aquí; el porqué está al pie de este bloque, con la migración.
--
-- `offset_confianza` -- de dónde salió ese número: 'ocr' (leído del cronómetro
-- del juego, el método bueno), 'nombre' (de la marca de hora del fichero),
-- 'manual' (lo dijo una persona) o null si nadie lo sabe todavía. Se guarda
-- porque un multistream mal sincronizado miente de forma convincente, y hay que
-- poder avisar de que esa alineación no está verificada.
--
-- `expira_en`: la retención son 3 meses. Al caducar se borran LOS BYTES, NO LA
-- FILA -- las guerras son permanentes y el puntaje de impacto lee las de hace
-- un año, así que el acta tiene que poder decir «hubo VOD, caducó» en vez de
-- dar un enlace roto. `fijado` es la excepción: lo que un oficial marca como
-- irrepetible no caduca nunca.
CREATE TABLE IF NOT EXISTS war_vods (
  id               TEXT PRIMARY KEY,
  war_id           TEXT NOT NULL REFERENCES wars(id) ON DELETE CASCADE,
  player_id        TEXT NOT NULL,
  estado           TEXT NOT NULL DEFAULT 'pendiente',
  nombre_original  TEXT,
  ruta             TEXT,
  bytes            BIGINT,
  duracion_ms      INTEGER,
  offset_ms        INTEGER,
  offset_confianza TEXT,
  recorte_ini_ms   INTEGER,
  recorte_fin_ms   INTEGER,
  fijado           BOOLEAN NOT NULL DEFAULT false,
  expira_en        TIMESTAMPTZ,
  aprobado_por     TEXT,
  subido_en        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS war_vods_war_idx ON war_vods (war_id, subido_en);

-- Para la tarea de limpieza, que pregunta a diario qué ha caducado. Parcial
-- porque lo fijado no le interesa nunca y son la mayoría de las filas viejas.
CREATE INDEX IF NOT EXISTS war_vods_caducados_idx
  ON war_vods (expira_en) WHERE NOT fijado;

-- Cómo va la preparación, para poder contestar «¿por qué lleva media hora en
-- Preparando?» sin entrar por SSH a mirar el log del contenedor.
--
-- Hacía falta porque `estado` es un estado plano: dice *que* está preparando y
-- nada más. Un remux con `-c copy` tarda segundos y un recodificado de HEVC
-- tarda una hora, y las dos cosas se veían exactamente igual desde la interfaz
-- -- igual que se veía un trabajo que ya no existía porque la API se reinició
-- con la cola en memoria.
--
-- `proceso_fase`: 'cola' (los bytes están, espera turno), 'origen' (el remux o
-- el recodificado que hace falta para poder ver el vídeo) o '360p' (la copia
-- de los mosaicos, que va DESPUÉS de que el estado pase a 'listo' y por eso
-- necesita nombre propio: sin él, «reproducible» y «terminado» se confunden).
-- Null cuando no hay nada en marcha.
--
-- `proceso_latido` es lo que distingue lento de muerto, que era justo lo que no
-- se podía distinguir. ffmpeg informa de su avance cada segundo; si el latido
-- se quedó atrás, no es que vaya despacio, es que ya no hay nadie trabajando.
--
-- `proceso_error` guarda el motivo. Antes sólo iba a `console.error`, así que
-- «Falló al preparar» era todo lo que llegaba a la persona que había esperado
-- veinte minutos a que subieran sus gigas. También recoge fallos PARCIALES, con
-- el estado en `listo`: si la copia de 360p no sale, la grabación se ve
-- perfectamente y lo único que pierde es poder entrar en un mosaico, y eso hay
-- que poder contarlo sin marcar como rota una grabación que no lo está.
ALTER TABLE war_vods ADD COLUMN IF NOT EXISTS proceso_fase   TEXT;
ALTER TABLE war_vods ADD COLUMN IF NOT EXISTS proceso_pct    SMALLINT;
ALTER TABLE war_vods ADD COLUMN IF NOT EXISTS proceso_desde  TIMESTAMPTZ;
ALTER TABLE war_vods ADD COLUMN IF NOT EXISTS proceso_latido TIMESTAMPTZ;
ALTER TABLE war_vods ADD COLUMN IF NOT EXISTS proceso_error  TEXT;

-- Cuándo se avisó por privado, para no avisar dos veces. Ver docs/VODS.md §9.
--
-- Hace falta marca y no basta con mirar el estado porque las dos cosas que
-- disparan un aviso se pueden repetir sin que haya nada nuevo que contar: una
-- grabación vuelve a pasar por `listo` cada vez que se reprepara -- un
-- reintento, o la recuperación al arrancar -- y «Publicar» se puede pulsar dos
-- veces sobre algo ya publicado. Un privado repetido no es un fallo cosmético:
-- es la clase de cosa por la que la gente silencia al bot.
ALTER TABLE war_vods ADD COLUMN IF NOT EXISTS aviso_revision_en TIMESTAMPTZ;
ALTER TABLE war_vods ADD COLUMN IF NOT EXISTS aviso_aprobada_en TIMESTAMPTZ;

-- Las calidades de un mismo VOD, cada una con su playlist de HLS.
--
-- Tabla aparte y no columnas porque no llegan a la vez: el original se
-- segmenta con `-c copy` en segundos, y la copia de 360p -- la que usan los
-- mosaicos del multistream, y la única que sobrevive si algún día se recorta la
-- retención -- sale de una cola de ffmpeg que tarda minutos. Un VOD reproducible
-- con una sola calidad es un estado normal, no uno a medias.
CREATE TABLE IF NOT EXISTS war_vod_renditions (
  vod_id        TEXT NOT NULL REFERENCES war_vods(id) ON DELETE CASCADE,
  calidad       TEXT NOT NULL,
  ruta_playlist TEXT NOT NULL,
  bytes         BIGINT,
  creada_en     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (vod_id, calidad)
);

-- Los momentos que alguien quiso señalar de una guerra. Ver docs/VODS.md.
--
-- Cuelgan de la GUERRA y no de la grabación, y es la decisión importante de
-- esta tabla: «aquí empujaron por el medio» es un hecho de la guerra en el
-- minuto T, no del vídeo de quien lo vio. Colgándolas de un VOD, el mismo
-- momento necesitaría una marca por grabación y no cuadrarían entre sí; en
-- tiempo de guerra, una sola marca sirve para las cuatro vistas del
-- multistream a la vez y saltar entre ellas mueve todos los mosaicos.
--
-- `t_ms` usa la misma referencia que `war_vods.offset_ms`: milisegundos desde
-- que arranca la partida, negativos durante la preparación. Situar una marca en
-- una grabación concreta es entonces `t_ms - offset_ms`, y por eso una
-- grabación sin sincronizar no puede enseñarlas: no se sabe dónde caen. Que la
-- resta sea lo único que importa es también lo que permitió mover el cero sin
-- mover nada de lo ya anotado.
--
-- `vod_id` es de dónde salió, no dónde vive. Sirve para saber por los ojos de
-- quién se vio aquello, y se pone a null si esa grabación caduca -- la marca
-- sobrevive al vídeo que la originó, igual que el acta sobrevive a sus bytes.
CREATE TABLE IF NOT EXISTS war_marcas (
  id         TEXT PRIMARY KEY,
  war_id     TEXT NOT NULL REFERENCES wars(id) ON DELETE CASCADE,
  vod_id     TEXT REFERENCES war_vods(id) ON DELETE SET NULL,
  autor_id   TEXT,
  t_ms       INTEGER NOT NULL,
  texto      TEXT NOT NULL,
  -- Un hito es lo que estructura la guerra --cayó la puerta, se perdió el
  -- boss-- y un comentario es todo lo demás. Se distinguen porque en una
  -- revisión de media hora quien busca «qué pasó» no quiere leerse treinta
  -- bromas para encontrar los cuatro momentos que importan.
  hito       BOOLEAN NOT NULL DEFAULT false,
  creada_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS war_marcas_guerra_idx ON war_marcas (war_id, t_ms);

-- El cero del tiempo de guerra pasa de la preparación a la partida.
--
-- Era el comienzo de la PREPARACIÓN, y con eso un fotograma en el que el reloj
-- del juego marcaba «0:47 · Fase de preparación» se anunciaba como «el minuto
-- 4:13 de la guerra» -- 5:00 menos 0:47. Coherente consigo mismo y contrario a
-- lo que ve quien mira: nadie lee un reloj que va hacia atrás y piensa en lo
-- que lleva transcurrido. Peor todavía dentro de la partida, donde el minuto 10
-- se anunciaba como el 15:00 por llevar la preparación sumada, que es una cifra
-- que no coincide con ningún reloj de la pantalla.
--
-- Ahora el cero es el arranque de la PARTIDA y la preparación es tiempo
-- negativo, que es como lo cuenta el juego y como lo cuenta la gente.
--
-- Se restan 5:00 a las dos columnas QUE SE MIDEN DESDE ESE CERO, y a las dos a
-- la vez: la posición de una marca dentro de un vídeo es `t_ms - offset_ms`, así
-- que desplazando ambas por igual no se mueve nada de lo ya anotado. El
-- multistream tampoco se entera: alinea por la diferencia entre offsets, y una
-- resta común no cambia ninguna diferencia. Cambia lo que se dice, no dónde
-- está nada.
--
-- La guarda es obligatoria y no cosmética: este fichero se ejecuta ENTERO en
-- cada arranque, así que un UPDATE aritmético sin marca restaría otros cinco
-- minutos en cada despliegue hasta desalinearlo todo. Va en `app_settings`, que
-- ya existe para cosas que sólo se hacen una vez.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app_settings WHERE key = 'vods_cero_en_partida') THEN
    UPDATE war_vods SET offset_ms = offset_ms - 300000 WHERE offset_ms IS NOT NULL;
    UPDATE war_marcas SET t_ms = t_ms - 300000;
    INSERT INTO app_settings (key, value) VALUES ('vods_cero_en_partida', '1');
  END IF;
END $$;
