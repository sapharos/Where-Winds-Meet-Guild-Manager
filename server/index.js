import express from 'express';
import { pool, migrate, replaceAll, GUILD_ID } from './db.js';

const app = express();
app.use(express.json({ limit: '5mb' }));

const PORT = Number(process.env.PORT) || 3001;

const asHandler = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((err) => {
    console.error(`${req.method} ${req.path} failed:`, err);
    res.status(500).json({ error: 'internal error' });
  });

// Rejects a body that is not an array before any of it reaches the database.
const requireArray = (req, res) => {
  if (Array.isArray(req.body)) return req.body;
  res.status(400).json({ error: 'expected a JSON array' });
  return null;
};

app.get('/api/health', asHandler(async (_req, res) => {
  await pool.query('SELECT 1');
  res.json({ status: 'ok', guild: GUILD_ID });
}));

app.get('/api/state', asHandler(async (_req, res) => {
  const [players, ranks, sessions] = await Promise.all([
    pool.query(
      `SELECT id, name, role, level, sect, platform, status, rank_id AS "rankId", notes
         FROM players WHERE guild_id = $1 ORDER BY name`,
      [GUILD_ID],
    ),
    pool.query(
      `SELECT id, name, color FROM ranks WHERE guild_id = $1`,
      [GUILD_ID],
    ),
    pool.query(
      `SELECT id, name, date, assignments, tactical_groups AS groups
         FROM war_sessions WHERE guild_id = $1 ORDER BY date DESC`,
      [GUILD_ID],
    ),
  ]);

  res.json({
    players: players.rows.map((p) => ({
      ...p,
      // The UI treats these as absent rather than null.
      platform: p.platform ?? undefined,
      rankId: p.rankId ?? undefined,
      notes: p.notes ?? undefined,
    })),
    ranks: ranks.rows,
    sessions: sessions.rows.map((s) => ({ ...s, date: s.date.toISOString() })),
  });
}));

app.put('/api/players', asHandler(async (req, res) => {
  const players = requireArray(req, res);
  if (!players) return;
  await replaceAll(
    'players',
    ['id', 'name', 'role', 'level', 'sect', 'platform', 'status', 'rank_id', 'notes'],
    players,
    (p) => [p.id, p.name, p.role, p.level, p.sect, p.platform ?? null, p.status, p.rankId ?? null, p.notes ?? null],
  );
  res.json({ saved: players.length });
}));

app.put('/api/ranks', asHandler(async (req, res) => {
  const ranks = requireArray(req, res);
  if (!ranks) return;
  await replaceAll('ranks', ['id', 'name', 'color'], ranks, (r) => [r.id, r.name, r.color]);
  res.json({ saved: ranks.length });
}));

app.put('/api/sessions', asHandler(async (req, res) => {
  const sessions = requireArray(req, res);
  if (!sessions) return;
  await replaceAll(
    'war_sessions',
    ['id', 'name', 'date', 'assignments', 'tactical_groups'],
    sessions,
    (s) => [
      s.id,
      s.name,
      s.date,
      JSON.stringify(s.assignments ?? []),
      JSON.stringify(s.groups ?? []),
    ],
  );
  res.json({ saved: sessions.length });
}));

migrate()
  .then(() => {
    app.listen(PORT, () => console.log(`API listening on ${PORT}`));
  })
  .catch((err) => {
    console.error('Startup failed:', err);
    process.exit(1);
  });
