# Self-hosting

The app is a static single-page bundle: Vite builds it, nginx serves it, and all
guild data lives in the browser's localStorage. There is no backend and no
database, so the container is stateless and safe to recreate at any time.

## Portainer (git stack)

1. **Stacks → Add stack → Repository**
2. Repository URL: `https://github.com/sapharos/Where-Winds-Meet-Guild-Manager`
3. Reference: `refs/heads/master`
4. Compose path: `docker-compose.yml`
5. Deploy.

Portainer builds the image on the host and publishes it on port `8085`. Change
the host port in `docker-compose.yml` if that one is taken.

## Plain Docker

```bash
docker compose up -d --build
```

## Base path

`BASE_PATH` controls the URL prefix Vite bakes into the asset links. The
Dockerfile sets it to `/` because nginx serves the app from the container root.
Leave it alone unless you put the app behind a reverse proxy on a subpath, e.g.
`/guild/`:

```bash
docker build --build-arg BASE_PATH=/guild/ -t wwm-guild-manager .
```

The default when the variable is unset is `/Where-Winds-Meet-Guild-Manager/`,
which is what the upstream GitHub Pages deploy needs.

## Internet access

The page pulls Tailwind, Font Awesome, and Google Fonts from public CDNs at
runtime, so client browsers need outbound internet even though the server is
local. The Strategic Link feature also relies on PeerJS's public broker to
introduce peers before they connect directly.

## Data

Everything is per-browser. Members and war plans saved on one machine are not
visible on another unless you use Export/Import or the live Strategic Link
session. Rebuilding or deleting the container does not touch that data.
