# Self-hosting

Two containers:

- **web** — nginx serving the built React app, and proxying `/api` to the API so
  everything is one origin (no CORS setup, no second port to expose).
- **api** — Node/Express talking to PostgreSQL.

PostgreSQL is *not* part of this stack. The API connects to the server you
already run.

## Configure

Copy `.env.example` to `.env` (or paste the same keys as stack environment
variables in Portainer):

```
DATABASE_URL=postgres://user:password@postgres:5432/wwm_guild
DATABASE_SSL=false
GUILD_ID=default-guild
GUILD_NAME=My Guild
WEB_PORT=8085
```

When PostgreSQL runs as another container, the host in `DATABASE_URL` is its
container name — but only if both stacks share a Docker network. Attach this one
by uncommenting the `networks` block at the bottom of `docker-compose.yml` and
filling in the network your database is on. If instead you reach the database by
host IP, no network change is needed.

Create the database and a user before the first start; the API creates its own
tables but will not create the database itself:

```sql
CREATE DATABASE wwm_guild;
CREATE USER wwm WITH PASSWORD 'something-long';
GRANT ALL PRIVILEGES ON DATABASE wwm_guild TO wwm;
```

## Portainer (git stack)

1. **Stacks → Add stack → Repository**
2. Repository URL: `https://github.com/sapharos/Where-Winds-Meet-Guild-Manager`
3. Reference: `refs/heads/master`
4. Compose path: `docker-compose.yml`
5. Add the environment variables above.
6. Deploy.

The schema is created on first start. `GET /api/health` returns `{"status":"ok"}`
once the API is connected, which is the quickest way to confirm the database
credentials are right.

## Running it locally

`docker-compose.dev.yml` adds a throwaway PostgreSQL so the whole stack runs on a
laptop without touching the real server:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build
```

To wipe that local database, `docker compose ... down -v`.

## Schema

`server/schema.sql`. Every row carries a `guild_id`, so one database can hold
several guilds later without a migration. There is also a `users` table with
`password_hash` and `role` — unused today, present so that adding logins is a
matter of writing endpoints rather than restructuring live data.

## What this does not do yet

**There is no authentication.** Anyone who can reach the web port can read and
edit the roster and the war plans. Keep it on your LAN or behind a VPN or an
authenticating reverse proxy until logins exist.

**Last write wins.** Each save replaces a whole collection in one transaction, so
the data is never left half-written, but two people editing the roster at the
same time will have one overwrite the other. The Strategic Link (PeerJS) feature
still works as before and is the intended way to run a planning session with
several people watching.

## Data safety

All guild data lives in PostgreSQL, so back it up the way you back up that
server. Export/Import still work and now read and write through the API; a
backup file exported from the old localStorage build imports cleanly.
