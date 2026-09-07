# Deploying to Railway + Neon + a static host

A split deploy: the API on Railway, Postgres on Neon, and the SPA on any
static host. This is the cheap alternative to `infra/` (AWS), which costs
$230–290/month.

```
  browser
     │
     ├── https://<app>.pages.dev ......... SPA (Cloudflare Pages / Vercel / Netlify)
     │
     └── https://<api>.up.railway.app .... Spring Boot + WebSocket (Railway)
                     │
                     ├── Neon ............ Postgres
                     └── Railway Redis ... cross-instance relay
```

Unlike the AWS setup, the SPA and API sit on **different origins**, so the
frontend must be told where the API lives and the API must allow the
frontend's origin. Both are single environment variables.

> **On cost:** Railway is not actually free. It gives a small trial credit and
> then requires the Hobby plan (~$5/month). Neon and Cloudflare Pages both have
> genuine free tiers. If you need everything free, the frontend and database
> are fine; only the API host costs money.

## 1. Neon (Postgres)

Create a project at [neon.tech](https://neon.tech). It hands you a connection
string like:

```
postgresql://alex:npg_xxxx@ep-cool-block-123456.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
```

Split it into the variables the app expects — don't paste it whole:

| Variable | From the URL |
|---|---|
| `POSTGRES_HOST` | `ep-cool-block-123456.ap-southeast-1.aws.neon.tech` |
| `POSTGRES_PORT` | `5432` |
| `POSTGRES_DB` | `neondb` |
| `POSTGRES_USER` | `alex` |
| `POSTGRES_PASSWORD` | `npg_xxxx` |
| `POSTGRES_SSLMODE` | `require` |

Use the **direct** endpoint, not the `-pooler` one. Flyway runs migrations at
startup and PgBouncer's transaction pooling interferes with the session-level
advisory locks it takes.

Neon's free compute suspends after ~5 minutes idle. The first request after a
suspend takes a few seconds while it resumes — the startup probe's 90-second
budget absorbs this.

## 2. Railway (API)

New Project → Deploy from GitHub repo → pick this repository. Railway reads
`railway.json` at the root, which points at `docker/backend.Dockerfile` and
sets the health check to `/actuator/health/readiness`.

Add a Redis service to the same project (New → Database → Redis).

Then set variables on the **backend** service:

```
POSTGRES_HOST=ep-....aws.neon.tech
POSTGRES_PORT=5432
POSTGRES_DB=neondb
POSTGRES_USER=...
POSTGRES_PASSWORD=...
POSTGRES_SSLMODE=require

REDIS_HOST=${{Redis.REDISHOST}}
REDIS_PORT=${{Redis.REDISPORT}}
REDIS_PASSWORD=${{Redis.REDISPASSWORD}}
REDIS_SSL=false

JWT_SECRET=<64+ random chars, see below>
CORS_ALLOWED_ORIGINS=https://<your-frontend-domain>
```

`${{Redis.REDISHOST}}` is Railway's reference syntax; it wires the services
together without copying credentials.

`REDIS_SSL=false` is correct here — Railway's Redis is reached over the
project's private network, not the public internet.

Generate the JWT secret locally and keep it out of git:

```bash
openssl rand -base64 48
```

Do **not** leave it at the default in `application.yml`. That value is
committed, so anyone could mint tokens for your deployment.

`PORT` is injected by Railway automatically; the app already binds it.

## 3. Frontend (static host)

Any static host works — the build output is just `dist/`. Config files for the
three common ones are committed:

| Host | File | Notes |
|---|---|---|
| Cloudflare Pages | `frontend/public/_redirects` | Free, no card, unlimited bandwidth |
| Netlify | `frontend/netlify.toml` | Free tier |
| Vercel | `frontend/vercel.json` | Free hobby tier |

All three do the same thing: serve `index.html` for unmatched paths, because
React Router owns the routes and a real 404 would break deep links.

Settings:

- **Build command:** `npm run build`
- **Output directory:** `dist`
- **Root directory:** `frontend`
- **Environment variable:** `VITE_API_URL=https://<your-api>.up.railway.app`

`VITE_API_URL` is read at *build* time, not runtime — changing it requires a
rebuild. The WebSocket URL is derived from it automatically, so there is
normally no need to set `VITE_WS_URL`.

## 4. Close the loop

Once the frontend has a URL, go back to Railway and set
`CORS_ALLOWED_ORIGINS` to that exact origin (scheme + host, no trailing
slash). Until you do, every API call fails preflight.

Verify:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://<api>.up.railway.app/actuator/health/readiness

curl -s -i -X OPTIONS https://<api>.up.railway.app/api/documents \
  -H 'Origin: https://<frontend-domain>' \
  -H 'Access-Control-Request-Method: GET' | grep -i access-control-allow-origin
```

The first should be `200`. The second should echo your frontend origin — if it
returns 403 with no header, `CORS_ALLOWED_ORIGINS` does not match.

## Verified locally

This exact split-origin configuration was tested before publishing, with the
SPA built for a foreign API origin and served on a different port:

- The WebSocket connects cross-origin and the editor reports "Synced"
- Snapshots and REST calls succeed across origins
- An allowed origin gets `Access-Control-Allow-Origin`; a disallowed one gets
  `403` with no CORS headers

## Trade-offs against the AWS setup

- **One instance.** `railway.json` sets `numReplicas: 1`. Redis Pub/Sub still
  works, but with a single instance the in-memory relay already covers every
  client, so Redis is doing nothing until you scale up.
- **No CDN.** The SPA is served by the static host's own edge network, which is
  fine; the API has no cache in front of it.
- **`setAllowedOrigins("*")` on the WebSocket.** The handshake is authenticated
  by JWT, so this is not an open door, but it is broader than the REST CORS
  policy. Tighten it in `WebSocketConfig` if you want them to match.
