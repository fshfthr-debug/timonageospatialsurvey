# Deploying SiteTrackerPro — free, open-source methods

Everything here uses free software (PostgreSQL, Node.js, Docker, Caddy) and can run on
free hosting. Nothing in this guide requires a paid service, a proprietary tool, or a
credit card except where a free host demands card verification for identity (noted).

Four routes, from quickest to most production-like:

| Route | Where it runs | Time | Good for |
|---|---|---|---|
| **A. Laptop / office PC** | Your own computer, no Docker | 15 min | Trying it, demos, training |
| **B. Any Linux server, one command** | A VPS or office server with Docker | 30 min | A real internal tool |
| **C. Free cloud server** | Oracle Cloud Always Free / Google Cloud free tier | 45 min | Public site, $0/month, you are the admin |
| **D. No server at all** | Render free + Neon free Postgres | 20 min | A quick public demo, no uploads |

Sections 1–2 explain what you are running and what is genuinely free. Sections 3–6 are the
four routes. Sections 7–11 cover HTTPS, backups, monitoring, updates and troubleshooting.

---

## 0. Read this before you expose the app to the internet

Three things are not optional:

1. **Set `JWT_SECRET`.** The app now **refuses to start** without a real one: at least 32
   characters, not the example value, not a repeated pattern. That is deliberate — this key
   signs every login, so a known value lets anybody mint a token for any account. Generate it
   with `openssl rand -hex 32` and keep it stable: changing it logs everybody out.
2. **Keep uploads on a volume.** Imported BIM/take-off files are written to `uploads/` on
   local disk. On a service with an ephemeral disk (Render, Railway, Fly) they disappear on
   every deploy. Routes B and C mount a volume; route D warns you.
3. **Know what is protected and what is still open.** Built in: rate limiting on sign-in
   (10 failed attempts per IP per 15 minutes) and registration (10 per hour), generic error
   messages, a 12-character password policy, a `JWT_SECRET` startup guard, a CORS allow-list
   driven by `CORS_ORIGIN`, and standard security headers from helmet (CSP, HSTS, no framing,
   no `X-Powered-By`). Still open from the review (§3.3): no audit trail, login tokens live in
   browser storage for 7 days, and uploads land on local disk.

Plain HTTP means passwords travel in clear text. Use HTTPS (section 7) for anything beyond
your own machine.

---

## 1. What you are actually running

SiteTrackerPro is three pieces, and one of them is optional:

```
browser ──HTTPS──▶ Caddy (optional, gives you a free certificate)
                        │
                        ▼
                  one Node process  ──▶  PostgreSQL 16
                  (Express API + the built React app)
                        │
                        └──▶  uploads/  (imported take-off files)
```

The Express backend already serves static files from `public/`. That is why the whole app
can run as **one container**: the React build is copied into `public/`, and the browser calls
`/api/...` and `/auth/...` on the same origin it was loaded from (the frontend is built with
an empty `REACT_APP_API_URL`). No CORS setup, no second web server needed.

What the app enforces by itself (no extra service needed):

| Control | Setting | Where |
|---|---|---|
| Failed sign-ins | 10 per IP per 15 minutes; successful logins do not count | `loginLimiter` in the backend |
| New accounts | 10 per IP per hour | `registerLimiter` in the backend |
| Password policy | 12+ characters, not the account's email, not a common password, not one repeated pattern, max 72 bytes (bcrypt's limit) | `validatePassword()` |
| Error messages | Generic text to the browser, full details to the server log | `serverError()` |
| Startup | Refuses to boot unless `JWT_SECRET` is 32+ characters and not a placeholder | `requireJwtSecret()` |
| Browser origins | Only the origins in `CORS_ORIGIN` may call the API cross-origin; `*` is refused | `ALLOWED_ORIGINS` |
| Response headers | CSP, HSTS, `X-Frame-Options: DENY`, `nosniff`, `no-referrer`, no `X-Powered-By` | helmet |

Ports:

| Port | What | Exposed to |
|---|---|---|
| 3001 | Node process (API + frontend) | only Caddy / localhost |
| 5432 | PostgreSQL | only the app's docker network |
| 80, 443 | Caddy | the internet |

---

## 2. The stack, and what is free in 2026

Software — all free and open source, no licence fees ever:

| Piece | Licence | Why it is here |
|---|---|---|
| PostgreSQL 16 | PostgreSQL Licence (BSD-like) | The database the schema targets |
| Node.js 20 LTS | MIT | Runs the backend |
| Express, pg, bcryptjs, jsonwebtoken | MIT | Already in `backend/package.json` |
| Docker + Compose | Apache-2.0 | Runs the three services reproducibly |
| Caddy 2 | Apache-2.0 | Automatic HTTPS with Let's Encrypt certificates |
| systemd | LGPL-2.1 | Keeps the app running without Docker |
| `pg_dump`, `tar`, `cron`, `rsync` | standard | Backups |

Hosting — checked November 2026, always re-check the provider page before you commit:

| Option | Free allowance | The catch |
|---|---|---|
| **Oracle Cloud Always Free** | 2 AMD micro VMs, or 2 Arm OCPU + 12 GB, 200 GB storage, 10 TB/month egress | Card for identity check; idle instances can be reclaimed; "out of capacity" is common in popular regions |
| **Google Cloud free tier** | One `e2-micro` in `us-west1`/`us-central1`/`us-east1`, 30 GB disk | 1 GB/month egress only — fine for testing, not for real traffic; needs a billing account |
| **Render** free web service | 750 instance-hours/month, 512 MB | Sleeps after 15 idle minutes (~1 min to wake); no persistent disk; its free Postgres **expires after 30 days** |
| **Neon** free Postgres | 1 GB, 100 compute-hours/month | Scales to zero after 5 minutes idle; wakes on the next query; no expiry |
| **DuckDNS** | Free subdomain under `duckdns.org` | Run by two volunteers; no SLA |
| **Cloudflare Tunnel** | Free on every plan | Quick tunnels get a new random URL each run and cap at 200 in-flight requests; a stable hostname needs a domain on Cloudflare |
| **Let's Encrypt** | Free TLS certificates | 90-day certs, renewed automatically by Caddy |

No longer free (do not follow old tutorials): **Heroku**, **Fly.io**, **Glitch**, and
**Koyeb's** card-free plan (removed February 2026).

A practical recommendation: Oracle's Always Free VM with Docker and Caddy (route C) is the
best free option for this app, because PostgreSQL and uploads need a real disk. Render +
Neon (route D) is easier but loses uploads on every deploy.

---

## 3. Route A — run it on your own computer (no Docker)

Good for trying the app, training staff, or a demo on a laptop.

### 3.1 Install the two prerequisites

- **Node.js 20 LTS** from <https://nodejs.org> (the "LTS" button). Node 22 also works; avoid
  odd-numbered releases.
- **PostgreSQL 16** from <https://www.postgresql.org/download/>.
  - Windows/macOS: the installer asks for a password for the `postgres` user — remember it.
  - Ubuntu/Debian: `sudo apt install postgresql`

### 3.2 Create the database and load the schema

```bash
# Ubuntu/Debian (macOS with Homebrew: use `psql postgres` instead of sudo -u postgres)
sudo -u postgres createuser --pwprompt sitetracker     # choose a password
sudo -u postgres createdb -O sitetracker sitetrackerpro_v3_enhanced

psql "postgresql://sitetracker:YOUR_PASSWORD@127.0.0.1:5432/sitetrackerpro_v3_enhanced" \
     -f database/schema.sql
```

Confirm the seed data arrived — this must print **51**:

```bash
psql "postgresql://sitetracker:YOUR_PASSWORD@127.0.0.1:5432/sitetrackerpro_v3_enhanced" \
     -c "SELECT count(*) FROM materials_ethiopian_standards;"
```

> Run `schema.sql` **once**. The materials table has no unique constraint, so running it a
> second time inserts the 51 materials again (102 rows). If that happens: drop the database,
> recreate it, load once.

### 3.3 Start the backend

```bash
cd backend
cp .env.example .env
```

Edit `backend/.env` — the important part is the port, because the React dev server also
wants 3000:

```ini
PORT=3001
DB_USER=sitetracker
DB_PASSWORD=YOUR_PASSWORD
DB_HOST=127.0.0.1
DB_PORT=5432
DB_NAME=sitetrackerpro_v3_enhanced
JWT_SECRET=paste-the-output-of-openssl-rand-hex-32
NODE_ENV=development
```

```bash
npm ci
npm start
# 🚀 SiteTrackerPro v3.0 Enhanced Backend running on port 3001
# ✅ Rate build-up table ready
```

If you see `⚠️ Could not prepare the rate build-up table`, the database settings are wrong —
the app still starts, but every data screen will fail.

### 3.4 Start the frontend

```bash
cd frontend
npm ci
npm start
```

It opens <http://localhost:3000> and proxies `/api` and `/auth` to `127.0.0.1:3001` (already
configured in `frontend/package.json`).

### 3.5 Check it works

1. Register an account (any email/password — there is no email verification in this version).
2. Create a project with a budget.
3. **BIM Import** → "Download CSV template" → import it → 4 components appear.
4. **Quantity Survey** → enter a rate per line → Save rates → Generate Bill of Materials.
5. **Fraud Check** → leave the sample numbers (60 vs 50 units, 10.20 vs 8.50 ETB) → the score
   should come out **90%** with **BLOCK PAYMENT**.

### 3.6 Production-style single process (no dev server)

```bash
cd frontend
REACT_APP_API_URL= npm run build          # ~1 min, produces frontend/build (~3.6 MB)
rm -rf ../backend/public && cp -r build ../backend/public

cd ../backend
PORT=3001 NODE_ENV=production npm start
```

Now <http://localhost:3001> serves the finished app *and* the API from one process. Keep it
running with `deploy/sitetrackerpro.service` (section 4.7).

---

## 4. Route B — one command on a Linux server (recommended)

Assumes Ubuntu 22.04/24.04 or Debian. Any VPS, mini-PC or spare machine works.

### 4.1 Install Docker (official script, open source)

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"      # then log out and back in
docker --version && docker compose version
```

### 4.2 Put the project on the server

```bash
sudo mkdir -p /opt && cd /opt
# copy the unzipped project here, e.g. with scp from your computer:
#   scp -r SiteTrackerPro-v3.0-Complete-Enhanced you@server:/opt/
sudo chown -R "$USER" /opt/SiteTrackerPro-v3.0-Complete-Enhanced
cd /opt/SiteTrackerPro-v3.0-Complete-Enhanced
```

### 4.3 Create the settings file

```bash
cp deploy/.env.example deploy/.env
openssl rand -hex 24      # paste into DB_PASSWORD
openssl rand -hex 32      # paste into JWT_SECRET
nano deploy/.env
```

`APP_DOMAIN` must be the name people will type. No domain yet? Put the server's IP address
there and use the HTTP-only proxy (4.6).

### 4.4 Start it

```bash
cd deploy
docker compose up -d --build      # first run: 3–6 minutes (installs and builds everything)
docker compose ps                 # db, api, web — api should say "healthy"
docker compose logs -f api        # Ctrl+C to stop watching
```

### 4.5 Load the database schema (first run only)

```bash
cd /opt/SiteTrackerPro-v3.0-Complete-Enhanced
docker compose --project-directory deploy exec -T db \
  psql -U sitetrackerpro -d sitetrackerpro_v3_enhanced < database/schema.sql

docker compose --project-directory deploy exec -T db \
  psql -U sitetrackerpro -d sitetrackerpro_v3_enhanced \
  -c "SELECT count(*) FROM materials_ethiopian_standards;"      # expect 51
```

The username and database name must match `DB_USER`/`DB_NAME` in `deploy/.env`.

### 4.6 First visit

- With a domain: `https://your-domain` — Caddy fetches the certificate automatically on the
  first request (give it ~30 seconds).
- **No domain yet:** `cp deploy/Caddyfile.http deploy/Caddyfile && docker compose restart web`,
  then open `http://SERVER-IP`. Switch back later with
  `cp deploy/Caddyfile.https.example deploy/Caddyfile && docker compose restart web`.

Register your account **immediately**, before the address is public — whoever registers first
owns the deployment (there are no admin invitations in this version).

### 4.7 Firewall

```bash
sudo ufw allow 22/tcp      # keep SSH open or you lock yourself out
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

PostgreSQL is deliberately never published to the host, so it cannot be reached from outside.

### 4.8 Everyday commands

```bash
cd /opt/SiteTrackerPro-v3.0-Complete-Enhanced/deploy
docker compose ps                       # status
docker compose logs -f api              # app logs
docker compose logs -f web              # certificate / request logs
docker compose restart api              # restart the app only
docker compose down                     # stop (data stays in volumes)
docker compose up -d                    # start again
docker compose down -v                  # DESTROYS the database and uploads
```

### 4.9 Same thing without Docker (systemd)

If you prefer a plain install on the server:

1. Install Node 20 and PostgreSQL, create the database and load the schema (section 3.2).
2. `sudo mkdir -p /opt/sitetrackerpro && sudo chown "$USER" /opt/sitetrackerpro`, copy the
   project there, then:

```bash
cd /opt/sitetrackerpro
sudo useradd --system --home /opt/sitetrackerpro sitetracker
npm --prefix backend ci
REACT_APP_API_URL= npm --prefix frontend ci    # then build:
(cd frontend && REACT_APP_API_URL= npm run build)
rm -rf backend/public && cp -r frontend/build backend/public
mkdir -p backend/uploads && sudo chown -R sitetracker:sitetracker /opt/sitetrackerpro
```

3. Put the settings in `/etc/sitetrackerpro.env` (root-only: `sudo chmod 600`), same keys as
   `backend/.env`, plus `PORT=3001` and `NODE_ENV=production`.
4. Install the service:

```bash
sudo cp deploy/sitetrackerpro.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now sitetrackerpro
systemctl status sitetrackerpro
journalctl -u sitetrackerpro -f
```

5. For HTTPS, install Caddy (`sudo apt install caddy`) and write `/etc/caddy/Caddyfile`:

```
your-domain.example {
	reverse_proxy 127.0.0.1:3001
}
```

then `sudo systemctl reload caddy`.

---

## 5. Route C — a free server in the cloud

### 5.1 Oracle Cloud Always Free (best free option)

1. Sign up at <https://www.oracle.com/cloud/free/>. A card is required for identity
   verification; Always Free resources are not charged.
2. **Compute → Instances → Create instance.**
   - Image: **Ubuntu 24.04**
   - Shape: **VM.Standard.A1.Flex** with 1–2 OCPUs and 6–12 GB memory (the Always Free
     allowance is 2 OCPU / 12 GB total), or **VM.Standard.E2.1.Micro** (AMD, 1 GB)
   - Add your SSH public key, then create.
   - If you get "out of host capacity", try another availability domain or region — this is
     common and temporary.
3. Open the ports in the cloud firewall: **Networking → VCN → Security Lists → Default →
   Add Ingress Rules** for TCP 80 and TCP 443 from `0.0.0.0/0`.
4. Open them on the machine too — Oracle's Ubuntu images block everything except SSH:

```bash
ssh ubuntu@YOUR_PUBLIC_IP
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo apt update && sudo apt install -y iptables-persistent
sudo netfilter-persistent save
```

5. Continue with route B from step 4.1 (Docker + the compose stack).

**Idle reclamation:** Oracle may reclaim an Always Free instance that stays under 20% CPU,
network and memory for seven days. A small app looks idle. Keeping a real user or a
monitoring check on it is normally enough; if you are worried, run a tiny weekly job that
touches the app (for example the health check in section 9, which also gives you uptime
alerts).

### 5.2 Google Cloud free tier

1. Create a project, then **Compute Engine → Create instance**:
   `e2-micro`, region `us-west1`, `us-central1` or `us-east1`, **Ubuntu 24.04**, 30 GB standard
   disk, allow HTTP/HTTPS traffic.
2. Add firewall rules for tcp:80 and tcp:443 (default `default-allow-http`/`https` tags).
3. SSH in from the console and follow route B.

The catch is the 1 GB/month egress — a few hundred page loads. Use it for a demo, not for
daily use.

### 5.3 A free hostname (DuckDNS)

You do not need to buy a domain to get HTTPS:

1. Go to <https://www.duckdns.org>, sign in, create a subdomain (e.g. `sitetracker`), copy the
   token.
2. Point it at your server's public IP:

```bash
curl "https://www.duckdns.org/update?domains=sitetracker&token=YOUR_TOKEN&ip=YOUR_PUBLIC_IP"
```

3. Keep it updated (only matters if your IP changes, e.g. an office connection):

```bash
crontab -e
*/5 * * * * curl -s "https://www.duckdns.org/update?domains=sitetracker&token=YOUR_TOKEN&ip=" >/dev/null
```

4. Set `APP_DOMAIN=sitetracker.duckdns.org` in `deploy/.env` and restart the stack. Caddy will
   obtain a certificate within about 30 seconds.

---

## 6. Route D — no server at all (Render free + Neon free)

Fastest public demo. Read the three warnings first; they are real.

- Render's free web service **sleeps after 15 idle minutes** (first visitor waits ~1 minute).
- The container's disk is **ephemeral**: imported take-off files vanish on the next deploy or
  restart. The app still works for everything except re-viewing old uploaded files.
- Render's free **Postgres expires after 30 days**, so use Neon for the database.

### 6.1 Put the project on GitHub (free)

Render deploys from a Git repository.

```bash
cd SiteTrackerPro-v3.0-Complete-Enhanced
git init && git add . && git commit -m "SiteTrackerPro with deployment kit"
# create an empty repository on github.com, then:
git remote add origin https://github.com/YOUR-NAME/sitetrackerpro.git
git branch -M main && git push -u origin main
```

`.dockerignore` already keeps `node_modules`, `build`, uploads and `.env` out of the image.

### 6.2 Create the free database

1. Sign up at <https://neon.com>, create a project in a region near your users.
2. Copy the connection string — it looks like
   `postgresql://USER:PASSWORD@ep-xxxx.eu-central-1.aws.neon.tech/neondb?sslmode=require`
   and split it into: host, port (5432), database, user, password.
3. Load the schema with any machine that has `psql`:

```bash
psql "postgresql://USER:PASSWORD@HOST/DBNAME?sslmode=require" -f database/schema.sql
```

### 6.3 Create the Render service

1. <https://render.com> → **New → Web Service** → connect the GitHub repo.
2. Runtime: **Docker**. Dockerfile path: `deploy/Dockerfile`. (Build context stays the repo
   root, which is what the Dockerfile expects.)
3. Instance type: **Free**.
4. Environment variables:

| Key | Value |
|---|---|
| `JWT_SECRET` | output of `openssl rand -hex 32` |
| `DB_HOST` | your Neon host |
| `DB_PORT` | `5432` |
| `DB_NAME` | your Neon database |
| `DB_USER` | your Neon user |
| `DB_PASSWORD` | your Neon password |
| `DB_SSL` | `true` |
| `NODE_ENV` | `production` |

Leave `PORT` alone — Render supplies it and the app reads it. Do **not** set
`REACT_APP_API_URL`: the image is built to call its own origin.

5. Deploy, then open the `.onrender.com` URL, register, and test.

`DB_SSL=true` is required because Neon (like Supabase and Render Postgres) refuses
unencrypted connections; the backend passes that through to `pg` as
`ssl: { rejectUnauthorized: false }`.

---

## 7. HTTPS, domains and tunnels

**Caddy does HTTPS automatically** for `APP_DOMAIN`: it requests a Let's Encrypt certificate
the first time somebody visits, stores it in the `caddy_data` volume and renews it at about
60 days. You need two things for this to work:

1. `APP_DOMAIN` resolves (DNS) to the machine's public IP — check with `dig +short your-name`.
2. Port 80 is reachable from the internet (the HTTP-01 challenge). 443 for the site itself.

**No domain, and no DuckDNS:** use a Cloudflare Quick Tunnel — free, no account, but the URL is
random and dies when the tunnel stops:

```bash
# with the stack running and Caddyfile.http in place (HTTP on port 80)
docker run --rm cloudflare/cloudflared:latest tunnel --no-autoupdate --protocol http2 \
  --url http://localhost:80
```

It prints an `https://something-random.trycloudflare.com` address. Good for a client demo,
not for daily use (200 in-flight requests, new URL each run).

**A stable hostname through Cloudflare** needs a domain added to Cloudflare (free plan) and a
named tunnel (`cloudflared tunnel login`, `create`, `route dns`), or simply point the domain's
DNS at your server and let Caddy handle certificates — that is fewer moving parts.

**Certificate not appearing?** In order: DNS wrong, port 80 blocked by the cloud firewall
*and* the OS firewall, or you restarted the `web` container so often that Let's Encrypt
rate-limited you (wait an hour). `docker compose logs web` says exactly which.

---

## 8. Backups and restore

`deploy/backup.sh` dumps the database and archives the uploads volume. Install it once:

```bash
chmod +x deploy/backup.sh
sudo mkdir -p /var/backups/sitetrackerpro
sudo crontab -e
15 2 * * * /opt/SiteTrackerPro-v3.0-Complete-Enhanced/deploy/backup.sh >> /var/log/sitetrackerpro-backup.log 2>&1
```

Run it once by hand to be sure it works, then look at the folder — you should see a
`db-*.sql.gz` and an `uploads-*.tar.gz`.

**Copy the backups off the machine.** A file on the same disk as the database is not a
backup. Free options: `rsync`/`scp` to a second machine, another free VM, or any storage you
already have. Then test a restore, once, on a throwaway database:

```bash
# database
gunzip -c /var/backups/sitetrackerpro/db-YYYYMMDDTHHMMSSZ.sql.gz \
  | docker compose --project-directory deploy exec -T db \
      psql -U sitetrackerpro -d sitetrackerpro_v3_enhanced

# uploads
docker run --rm -v sitetrackerpro_uploads:/data \
  -v /var/backups/sitetrackerpro:/backup alpine:3 \
  sh -c "tar xzf /backup/uploads-YYYYMMDDTHHMMSSZ.tar.gz -C /data"
```

A restore you have never tested is a hope, not a backup.

---

## 9. Monitoring and logs

- **Health check:** `GET /health` returns JSON and needs no database or login. The compose
  file health-checks the container with it every 30 seconds.
- **Uptime alerting, free and open source** — Uptime Kuma in one command:

```bash
docker run -d --restart=always --name uptime-kuma \
  -p 3003:3001 -v uptime-kuma:/app/data louislam/uptime-kuma:1
```

Open `http://SERVER-IP:3003`, add an HTTP(s) monitor for `https://your-domain/health`, and an
email or Telegram notification. (Bind it to a private address or put it behind Caddy if the
machine is public.)
- **Logs:** `docker compose logs -f --tail=200 api`. Caddy logs requests to stderr, so
  `docker compose logs web` shows every visit.
- **Disk:** `df -h` and `du -sh /var/lib/docker/volumes/sitetrackerpro_*`. Uploads and backups
  are the usual culprits; a 100 MB BIM upload limit is configured in the backend.

---

## 10. Updating and rolling back

```bash
cd /opt/SiteTrackerPro-v3.0-Complete-Enhanced
# replace the code (git pull, or unzip a new version over it — keep deploy/.env!)
cd deploy
docker compose up -d --build      # rebuilds and restarts; downtime ~10–30 seconds
docker compose ps                 # confirm api is healthy again
```

Database changes: this version ships a single `database/schema.sql` and has no migration
tool. Never re-run it against a live database (it duplicates the 51 seed materials). Apply
schema changes by hand as SQL, taking a backup first.

Rolling back: keep the previous version's folder, or tag images
(`docker build -t sitetrackerpro:2026-11-16 -f deploy/Dockerfile .`) and change the `api`
service to `image: sitetrackerpro:2026-11-16` instead of `build:`. Database changes are not
rolled back automatically.

---

## 11. Troubleshooting

| What you see | Cause | Fix |
|---|---|---|
| `EADDRINUSE` on 3000 in development | Backend and React dev server both use 3000 | Set `PORT=3001` in `backend/.env`; the frontend already proxies to 3001 |
| `relation "projects" does not exist` | Schema never loaded | Section 4.5 |
| Materials list shows 102 rows / duplicated materials | `schema.sql` was run twice | Drop and recreate the database, load once |
| `database "sitetrackerpro_v3_enhanced" does not exist` | `POSTGRES_DB` differs from `DB_NAME` | Make them match in `deploy/.env`, or create the DB |
| `password authentication failed` | `DB_PASSWORD` mismatch between `.env` and the volume's original password | Change both, or reset inside `psql` |
| `no pg_hba.conf entry ... SSL off` / SSL required | Managed Postgres (Neon/Supabase/Render) needs TLS | Set `DB_SSL=true` |
| Caddy logs `no such host` or `timeout during connect` | DNS not pointing at the server, or port 80 blocked | Section 7 |
| Site loads but every screen is empty, no error | Expired/edited `JWT_SECRET` invalidates tokens; the app does not log you out on 401 | Clear the browser's local storage for the site and log in again |
| Imported files disappear after a deploy | No volume mounted (route D) | Use routes B/C, or move uploads to object storage |
| `EACCES` writing to `uploads` | Volume owned by root, container runs as `node` | `docker compose exec -u root api chown -R node:node /app/uploads` |
| 413 on a large BIM upload | Proxy body limit (Cloudflare Free is 100 MB) | Keep files under 100 MB or upload straight to the server |
| App image builds but page is blank | Built without an empty `REACT_APP_API_URL` | Rebuild with `REACT_APP_API_URL=""` |
| Server starts, logs `ECONNREFUSED ...5432` | Database not up yet or wrong host | `docker compose ps`; `DB_HOST=db` inside compose, `127.0.0.1` outside |
| Login works, then "Invalid token" | `JWT_SECRET` changed between restarts | Keep it stable in `deploy/.env` |
| "Too many failed sign-in attempts" | Login limiter: 10 failures per IP per 15 minutes (registration: 10 per hour) | Wait 15 minutes, or `docker compose restart api` to clear the counters |
| Everyone is locked out after a few bad logins | The API sees one IP, so `TRUST_PROXY` is wrong behind Caddy | Leave `TRUST_PROXY=1` (the default); set `TRUST_PROXY=false` only if the API is exposed directly |
| Registering fails with "Use at least 12 characters" | Password policy | 12+ characters, not the email address, not a common password, not one repeated character |
| App exits immediately: "Refusing to start: JWT_SECRET…" | Secret missing, under 32 characters, or still the example value | `openssl rand -hex 32`, put it in `JWT_SECRET`, `docker compose up -d` |
| Browser console: "blocked by CORS policy" | The page's origin is not in `CORS_ORIGIN` | Add the exact origin (scheme + host + port, no trailing slash) and restart `api` |
| Frontend on a separate host loads but every API call fails | API allows only same-origin, and the build points elsewhere | Set `CORS_ORIGIN` to the frontend origin and rebuild with `REACT_APP_API_URL` |

---

## 12. Cost summary

| Item | Cost |
|---|---|
| Node.js, PostgreSQL, Caddy, Docker, Uptime Kuma | $0 (open source) |
| Let's Encrypt certificate | $0 |
| DuckDNS subdomain | $0 |
| Oracle Cloud Always Free VM | $0 (card for verification; idle instances can be reclaimed) |
| Google Cloud e2-micro | $0 within the free tier (1 GB egress/month) |
| Render free web service | $0 (sleeps when idle, no persistent disk) |
| Neon free Postgres | $0 (1 GB, scales to zero when idle) |
| Domain you buy yourself | ~$10–15/year, optional |

Everything above can be run without paying anything. The honest trade is that a free tier
makes you the system administrator: updates, backups, certificates and monitoring are yours.

---

## 13. What was verified when writing this guide

- The React production build succeeds with an empty `REACT_APP_API_URL` (Node 26 here; the
  Dockerfile pins Node 20 LTS), producing a 3.6 MB `build/` folder, 216 KB gzipped JS.
- The backend, serving that build from `backend/public`, answers `GET /` with the app's
  `index.html` (200), serves `/static/js/*.js` with the right content type, answers
  `/health`, and still returns `{"error":"No token"}` 401 for `/api/projects` — i.e. the
  single-process layout in section 3.6 works.
- The backend starts and stays up when the database is unreachable, logging
  `⚠️ Could not prepare the rate build-up table` — matching the troubleshooting entry.
- The compose file, Caddyfile, systemd unit and backup script were checked for syntax and
  consistency (service names, ports, volume names, env keys) but **not executed** — no Docker
  daemon, PostgreSQL server or Word/browser were available in the environment where this was
  written. Expect to spend the first ten minutes of a real deployment confirming sections 4.4
  to 4.6 on your own machine.
