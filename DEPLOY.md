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
DATABASE_URL=postgres://wwm:the-password@192.168.1.80:5433/wwm_db
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

Create the database and a role before the first start; the API creates its own
tables but will not create the database itself. Give the app its own role and
make it the owner, so its credentials are not the same ones any other
application on that server uses:

```sql
CREATE USER wwm WITH PASSWORD 'something-long';
CREATE DATABASE wwm_db OWNER wwm;
```

Note that PostgreSQL lets any role connect to any database by default. The `wwm`
role owns only `wwm_db`, but it is not *blocked* from opening a connection to
your other databases. If you want that closed off, revoke the default on each
one — check first that nothing else depends on it:

```sql
REVOKE CONNECT ON DATABASE other_db FROM PUBLIC;
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

## Accounts and roles

Signing in is required; nothing is readable without it.

On the very first start, when the guild has no accounts at all, one
administrator is created. Set `ADMIN_USERNAME` and `ADMIN_PASSWORD` to choose
the credentials. If you leave `ADMIN_PASSWORD` empty a random one is generated
and printed **once** in the API container log:

```bash
docker logs wwm-guild-manager-api
```

After that first account exists, those two variables do nothing — manage
accounts from the **Administración** tab in the app.

There are five roles: `admin`, `leader`, `subleader`, `officer`, `member`. What
each one may do is stored in the database and edited from the same tab, so you
can change the arrangement without touching code. The defaults are in
`server/permissions.js` and apply only when a guild has no matrix yet.

Two safeguards exist because a permission editor can otherwise lock everyone out
of their own guild:

- `admin` always keeps *Gestionar usuarios* and *Editar permisos*. The checkboxes
  are shown fixed, and the server re-adds them even if a request omits them.
- The last enabled administrator cannot be demoted, disabled, or deleted, and
  nobody can delete their own account.

Permissions are read from the database on every request rather than from the
session cookie, so a role change or a disabled account takes effect immediately
for anyone already signed in.

### Sessions

Sessions are a signed JWT in an httpOnly cookie, valid for seven days.
`SESSION_SECRET` signs them; leave it empty and one is generated and kept in the
database, which means restarts do not sign everyone out. Changing it invalidates
every existing session.

Set `COOKIE_SECURE=true` once the app is served over HTTPS, so the cookie is
never sent in the clear.

## The Discord bot

Optional, and separate from signing in with Discord. With `DISCORD_BOT_TOKEN`
and `DISCORD_GUILD_ID` set, the **Administración** tab can search the guild's
Discord server and link members to their accounts by hand — no sign-in round
trip needed — and create passwordless accounts straight from a roster entry
plus a Discord identity.

Setting it up, once:

1. In [discord.com/developers](https://discord.com/developers/applications),
   open the same application used for signing in, go to **Bot**, and copy the
   token. That is `DISCORD_BOT_TOKEN`.
2. Invite the bot to the guild's Discord server (needs *Manage Server* there):
   `https://discord.com/oauth2/authorize?client_id=<DISCORD_CLIENT_ID>&scope=bot%20applications.commands`
   No permissions are requested; member search needs none.
3. With developer mode on (User Settings → Advanced), right-click the server's
   name and *Copy Server ID*. That is `DISCORD_GUILD_ID`.

Linking by hand replaces the proof of ownership that the OAuth flow gives with
the linker's own judgement, and a linked Discord signs straight in as that
account — so the whole feature sits behind the *Gestionar usuarios* permission,
and the panel shows both the server nickname and the global username before
anything is saved.

### War voice channels

With the bot set up, **Administración → Canales de voz de guerra** maps the
guild's voice channels to the war board: one general channel, one per side, one
per lane of each side. The Sala de Guerra then offers anyone with the *Mover a
canales de voz* permission (officers and up by default) three one-click moves:
gather everyone in the general channel, split by side, or spread each deployed
member to their lane's channel.

Two things Discord requires for this to work:

- The bot's role needs the **Move Members** permission in those voice channels
  (grant it channel-by-channel to keep it scoped).
- A member can only be moved if they are already connected to some voice
  channel in the server, and only if their Discord is linked to their account.
  The result message names whoever could not be moved and why.

## What this does not do yet

**Last write wins.** Each save replaces a whole collection in one transaction, so
the data is never left half-written, but two people editing the roster at the
same time will have one overwrite the other. The Strategic Link (PeerJS) feature
still works as before and is the intended way to run a planning session with
several people watching.

**The Strategic Link is not permission-aware.** Anyone given the broadcast id can
follow along read-only without signing in. Treat that id as a shared secret.

## Data safety

All guild data lives in PostgreSQL, so back it up the way you back up that
server. Export/Import still work and now read and write through the API; a
backup file exported from the old localStorage build imports cleanly.
