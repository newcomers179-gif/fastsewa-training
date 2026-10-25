# Deploying FastSewa

This guide takes the project from a fresh server to a running, backed-up, monitored service. It has two
paths: **A**, one Linux server with Docker and nginx (written out in full), and **B**, a platform that runs
Docker images (Render, Railway, Fly.io and similar). Day-to-day running is in [docs/RUNBOOK.md](docs/RUNBOOK.md); the
mobile app is built and published separately ([docs/MOBILE-RELEASE.md](docs/MOBILE-RELEASE.md)).

```
phones (the app) ──┐                                      ┌──▶ PostgreSQL (managed, with backups)
                   ├─https─▶ nginx :443 ─▶ API :5000 ─────┼──▶ media: YouTube links, or S3 / Cloudinary / local disk
browsers (/admin,  │        (TLS, flood guard)  (Docker)  ├──▶ SMTP (password-reset e-mail, optional)
 /verify) ─────────┘                                      └──▶ Expo push service (notifications, optional)
```

The API is one container. It applies pending database migrations when it starts, serves the admin console at `/admin`
and the public certificate page at `/verify`, and shuts down cleanly when told to.

## Before you start

| You need | Why | Notes |
|----------|-----|-------|
| A domain name for the API, e.g. `api.yourdomain.com` | HTTPS certificates, and the address printed on every certificate (QR code) | Cannot be changed later without reissuing links people have already printed |
| A server (path A) or a platform account (path B) | Runs the API | 2 vCPU / 2 GB is a sensible start; resize after a month of real numbers |
| **A managed PostgreSQL database** (14 or newer; 16 recommended) with automatic backups | All data lives here | Prefer a region in India. Neon, Supabase, Render, AWS RDS and DigitalOcean all work: anything that gives a connection URL |
| A person who owns backups, updates and incidents | Nobody else will | [docs/RUNBOOK.md](docs/RUNBOOK.md) is written for that person |
| The privacy notice, terms and a support contact | Shown in the app; required before real learners sign up | [docs/DPDP-CHECKLIST.md](docs/DPDP-CHECKLIST.md) |
| Optional: an SMTP account | Password-reset codes by e-mail. Without it trainers issue temporary passwords | Brevo, Resend, Amazon SES, Mailgun, Gmail all work |
| Optional: media storage | Uploading videos and images. YouTube links need none | See "Media storage" below |
| Accounts for the app stores and Expo | Mobile builds | [docs/MOBILE-RELEASE.md](docs/MOBILE-RELEASE.md) |

Nothing in this repository can create those accounts or pay for them; they are listed in [docs/REMEDIATION.md](docs/REMEDIATION.md) under "Needs you".

---

## Path A: one Linux server (Docker Compose + nginx)

Written for Ubuntu 24.04 LTS (Debian 12 is the same). Work as a normal user with `sudo`, not as root.

### 1. The server

```bash
sudo apt update && sudo apt install -y nginx certbot ufw curl git postgresql-client
curl -fsSL https://get.docker.com | sudo sh         # Docker Engine with the Compose plugin; or follow docs.docker.com/engine/install
sudo usermod -aG docker "$USER"                      # then log out and back in
sudo ufw allow OpenSSH && sudo ufw allow 'Nginx Full' && sudo ufw --force enable
```

Point the DNS `A` record of `api.yourdomain.com` at the server now, so it has spread by the time you need the certificate.
`postgresql-client` provides `pg_dump` for the backups. On Ubuntu 24.04 it is version 16; if your managed database is newer than
your client, install the matching `postgresql-client-NN` from the PostgreSQL apt repository (pg_dump refuses to dump a newer server).

The firewall opens only SSH, 80 and 443. The API listens on `127.0.0.1:5000` and the database is a managed service, so neither is reachable from the internet.

### 2. The code

```bash
sudo mkdir -p /opt/fastsewa && sudo chown "$USER": /opt/fastsewa
git clone <your repository URL> /opt/fastsewa && cd /opt/fastsewa
git checkout v3.0.0          # deploy a tagged release, never a moving branch
```

### 3. Settings

```bash
cp .env.example .env && chmod 600 .env
openssl rand -hex 48         # paste the output as JWT_SECRET
nano .env
```

Fill in at least these (the file explains every other setting):

| Setting | Value |
|---------|-------|
| `PUBLIC_BASE_URL` | `https://api.yourdomain.com` |
| `DATABASE_URL` | the connection string from your database provider (percent-encode special characters in the password) |
| `JWT_SECRET` | the random value from above. Keep a copy in your password manager: losing it signs everyone out, a leak lets people forge logins |
| `REGISTRATION_MODE` and `REGISTRATION_CODE` | `code` with a code you give out at the site, `open`, or `closed` |
| `SUPPORT_EMAIL`, `SUPPORT_PHONE`, `PRIVACY_POLICY_URL`, `TERMS_URL` | shown to learners in the app |

The API refuses to start in production with a missing or unsafe value and prints exactly what to fix, so a mistake costs you one
restart and not a silent misconfiguration.

### 4. Start it

```bash
docker compose up -d --build
docker compose logs -f api              # wait for "FastSewa API listening", then Ctrl-C
curl -s http://127.0.0.1:5000/api/health/ready
```

The last command prints `{"status":"ready", ...}`. The first start applies every migration to the empty database.
To run your own PostgreSQL in the same stack instead of a managed one, see the notes at the top of `docker-compose.yml`
(`--profile local-db`); you then own its backups, patching and disk.

### 5. The first admin

```bash
docker compose exec api node dist/create-admin.js yourname "Your Name" --generate
```

It prints a one-time password. Sign in at `https://api.yourdomain.com/admin/` once the next step is done; you will be asked to choose a
real password straight away. If the only admin ever forgets the password, `--reset yourname` on the same command issues a new one-time password.
**Do not run `npm run seed` on a real deployment**: it creates sample accounts and courses and refuses to run in production for that reason.

### 6. HTTPS and nginx

Get the certificate first, then install the real configuration:

```bash
sudo mkdir -p /var/www/certbot
sudo rm -f /etc/nginx/sites-enabled/default
sudo tee /etc/nginx/conf.d/fastsewa-acme.conf > /dev/null <<'EOF'
server {
    listen 80;
    server_name api.yourdomain.com;
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 404; }
}
EOF
sudo nginx -t && sudo systemctl reload nginx

sudo certbot certonly --webroot -w /var/www/certbot -d api.yourdomain.com -m you@yourdomain.com --agree-tos --no-eff-email

sudo rm /etc/nginx/conf.d/fastsewa-acme.conf
sudo cp nginx/fastsewa.conf /etc/nginx/conf.d/fastsewa.conf
sudo sed -i 's/api\.example\.com/api.yourdomain.com/g' /etc/nginx/conf.d/fastsewa.conf
sudo nginx -t && sudo systemctl reload nginx

# renew automatically (certbot installs the timer) and reload nginx after each renewal
printf '#!/bin/sh\nsystemctl reload nginx\n' | sudo tee /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh > /dev/null
sudo chmod +x /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
sudo certbot renew --dry-run
```

If the host has no IPv6, delete the two `listen [::]:…` lines in the nginx file or nginx will not start. What the configuration does
(flood guard, streamed uploads, JSON error pages, `/api/health/ready` closed to the outside, request ids shared with the API logs) is explained in its comments.
It trusts one proxy hop: if you put a CDN in front of nginx, read the notes at the top of that file and set `TRUST_PROXY` to match.

### 7. Check it from outside

From your own computer, not the server:

```bash
curl -s https://api.yourdomain.com/api/health           # {"status":"ok","version":"3.0.0",...}
curl -s -o /dev/null -w '%{http_code}\n' https://api.yourdomain.com/api/health/ready    # 403: closed to the outside on purpose
```

Then work through the checklist at the end of this page.

### 8. Backups, logs, monitoring (do this on day one, not after the first incident)

```bash
sudo mkdir -p /var/backups/fastsewa && sudo chown "$USER": /var/backups/fastsewa
sudo touch /var/log/fastsewa-backup.log && sudo chown "$USER": /var/log/fastsewa-backup.log
( crontab -l 2>/dev/null; echo '17 2 * * * cd /opt/fastsewa && BACKUP_DIR=/var/backups/fastsewa BACKUP_KEEP_DAYS=30 scripts/ops/backup-db.sh >> /var/log/fastsewa-backup.log 2>&1' ) | crontab -
cd /opt/fastsewa && BACKUP_DIR=/var/backups/fastsewa scripts/ops/backup-db.sh      # run one now to see it work
```

* **Copy backups off the server**, because a backup on the disk that dies is not a backup. Set `BACKUP_AFTER_COMMAND` (for example `rclone copy "$1" remote:fastsewa/`) and
  `BACKUP_PASSPHRASE_FILE` to encrypt them; both are explained at the top of `scripts/ops/backup-db.sh`.
  A managed database also keeps its own backups: check its retention and whether point-in-time recovery is on.
* **Rehearse a restore** into a scratch database once a month ([docs/RUNBOOK.md](docs/RUNBOOK.md), "Restore drill"). A backup nobody has restored is a hope.
* **Logs:** the API writes one JSON line per request and per error to the container log (10 MB × 10 files per container, rotated by Docker); nginx writes
  `/var/log/nginx/fastsewa.access.log` (rotated by the distribution's logrotate). Indian CERT-In directions ask for logs to be kept for 180 days, and the DPDP Rules (from 13 May 2027, as I read them)
  for at least one year for logs of processing: decide where they go (a log service, or a nightly copy to storage you control) and for how long, with your counsel
  ([docs/DPDP-CHECKLIST.md](docs/DPDP-CHECKLIST.md)).
* **Monitoring:** point an external uptime monitor at `https://api.yourdomain.com/api/health` once a minute and have it alert a human. Also watch free disk space, the
  certificate's expiry date and the backup log. [docs/RUNBOOK.md](docs/RUNBOOK.md) lists what to look at and what each alarm means.

---

## Path B: a platform that runs Docker images (Render, Railway, Fly.io, ...)

The platform builds the `Dockerfile` (last stage, `production`) or pulls the image that `.github/workflows/deploy.yml` publishes to
`ghcr.io/<owner>/<repository>-api`. Settings that matter:

| Setting | Value |
|---------|-------|
| Port | `5000`, or whatever the platform puts in `PORT` (the API reads it) |
| Health check path | `/api/health` (liveness: it never touches the database, so a database outage does not make the platform restart healthy containers) |
| Environment | everything from `.env.example` that applies; `PUBLIC_BASE_URL` is the platform's `https://` address or your custom domain |
| `TRUST_PROXY` | `1` (the default) for a platform load balancer; `2` if a CDN such as Cloudflare is also in front |
| Media | use S3 or Cloudinary. A container's disk is lost on redeploy; `MEDIA_PROVIDER=local` needs a persistent disk |
| Shutdown | the API drains for 5 s and force-closes after 25 s on SIGTERM: allow the platform at least 30 s |
| Migrations | applied at container start (safe with several instances: they take a database lock). To migrate as a separate release step, set `RUN_MIGRATIONS=false` and run `node dist/migrate.js` there |
| More than one instance | set `REDIS_URL` so rate-limit counters are shared |

TLS and the domain are the platform's job, so there is no nginx. `/api/health/ready` is then reachable from the internet and shows database latency and pool counts: harmless, but
use `/api/health` for public monitors. Free plans that put the service to sleep when idle are not suitable: the first learner of the morning would wait a minute.
Create the first admin with the platform's shell: `node dist/create-admin.js yourname "Your Name" --generate`.

---

## Updating, and going back

```bash
cd /opt/fastsewa
git fetch --tags && git checkout v3.0.1                       # the release you are deploying
scripts/ops/backup-db.sh                                      # a fresh backup first, always
docker compose up -d --build                                  # rebuilds and replaces the container
docker compose logs --tail 50 api && curl -s http://127.0.0.1:5000/api/health
```

Or, to deploy the image your CI built instead of building on the server:
`API_IMAGE=ghcr.io/<owner>/<repository>-api:3.0.1 docker compose pull api && API_IMAGE=ghcr.io/<owner>/<repository>-api:3.0.1 docker compose up -d --no-build`.

* **Downtime** is a few seconds while the container is replaced: nginx answers a short JSON "temporarily unavailable" instead of an error page, the app retries reads twice by itself and otherwise
  shows the last data it has with a "try again" option. A save in flight at that moment may need another tap. Do it outside shift hours. Zero-downtime updates need two API containers behind the proxy, which this setup does not do.
* **Migrations** run automatically before the new version starts. They are written to stay compatible with the previous release (new columns and tables first, removal one release
  later), so going back to the previous version does not need the database rolled back.
* **Going back:** `git checkout v3.0.0 && docker compose up -d --build`, or start the previous image tag with `--no-build`. Check `curl .../api/health` shows the old version.
  If a release's migration did something destructive that must be undone, restore the backup you took before updating ([docs/RUNBOOK.md](docs/RUNBOOK.md)).
* To publish a release image from GitHub: bump the version everywhere (`package.json`, `server/package.json`, `app.json`; `npm run check:release` compares them), commit, then `git tag v3.0.1 && git push origin v3.0.1`.
  `.github/workflows/deploy.yml` checks the tag against the version, builds the image, publishes it and, if you configured a deploy hook, deploys it and waits until `/api/health` reports the new version.

---

## Media storage

Lessons can link to a **YouTube** video with no setup. To let admins **upload** videos and images, choose one provider and set `MEDIA_PROVIDER` (see `.env.example`):

| Provider | Setup in short |
|----------|----------------|
| **S3 or compatible** (AWS S3, Cloudflare R2, Backblaze B2, DigitalOcean Spaces, MinIO) | Create a bucket. The browser uploads straight to it with a short-lived signed URL, so give the bucket a CORS rule (below). The files must be readable by the public at `MEDIA_PUBLIC_BASE_URL` (a public-read bucket policy for the `fastsewa/` prefix, or a CDN in front); the address of each upload is stored in the lesson. Give the API's access key only `s3:PutObject`, `s3:GetObject` (also what a HEAD request needs) and `s3:DeleteObject` on that bucket. |
| **Cloudinary** | Set the three `CLOUDINARY_*` values. Uploads are signed by the API and go straight to Cloudinary. |
| **Local disk** | Single server only. `docker-compose.yml` mounts a named volume at `/data/uploads`; back that volume up with the database, since uploaded videos cannot be recreated from it. nginx streams uploads to the API; keep `MAX_VIDEO_MB` and nginx's `client_max_body_size` in step. |

S3 CORS rule (the admin console runs on the API's own address, so that is the allowed origin):

```json
[{ "AllowedOrigins": ["https://api.yourdomain.com"], "AllowedMethods": ["PUT"], "AllowedHeaders": ["*"], "ExposeHeaders": ["ETag"], "MaxAgeSeconds": 3000 }]
```

Uploaded lesson media is meant to be public: anyone with a file's long random address can play it. Do not upload anything that must stay private.

## E-mail

Set all four of `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` (and `SMTP_FROM`) and the "Forgot password" screen starts sending codes; leave them empty and it tells learners to
ask their trainer, who can issue a temporary password in the admin console. Port 465 uses TLS from the start; 587 upgrades with STARTTLS. Use a sending domain you control and add its SPF and DKIM records at your mail provider, or reset
e-mails land in spam. Test with a real address after the first deploy.

## Acceptance checklist for day one

- [ ] `https://api.yourdomain.com/api/health` shows the version you deployed; `/api/health/ready` is closed (403) from the internet (path A)
- [ ] Sign in to `/admin/` with the one-time password, choose a real password, sign out and in again
- [ ] Create a course with one text lesson, one video lesson and a quiz, publish it. Sample content is not for real learners
- [ ] On a real phone with the store or preview build: register (with the registration code), finish the lessons, pass the quiz, receive the certificate, open its PDF
- [ ] Scan the certificate's QR code: `/verify/<number>` shows it as valid. Revoke it in the admin console and check that the page now says so
- [ ] Switch the app to Hindi; read one lesson and one quiz question aloud to someone who reads Hindi (the translations need a native speaker's review)
- [ ] "Forgot password": a code arrives by e-mail (or the screen sends the learner to the trainer, if SMTP is not set up)
- [ ] The audit log (admin console) shows what you just did
- [ ] A backup file exists, and you have restored one into a scratch database
- [ ] The uptime monitor has paged you once on purpose (stop the container, wait, start it)
- [ ] Privacy notice, terms and support contact are real and reviewed ([docs/DPDP-CHECKLIST.md](docs/DPDP-CHECKLIST.md))

## Sizing

Numbers worth knowing, measured on a 2-vCPU test machine (yours will differ):

* A sign-in costs about 100 ms of one CPU core (scrypt, deliberately slow; at most 3 run at once), so a crew of 100 signing in at the same minute takes the machine about 5 s of CPU, and
  more than 200 queued hashes get a "server busy" answer that the app retries. That is the first thing a very large shift start would feel; `PASSWORD_HASH_CONCURRENCY` and a bigger machine
  are the answer.
* Video lessons report progress every 10 seconds per watching learner; the per-user limit (300 requests a minute) is far above that.
* The database connection pool defaults to 10 (`DB_POOL_MAX`). Managed plans cap connections: stay under the cap when you add API containers.

Start with 2 vCPU / 2 GB for the API and the smallest managed database plan that includes automatic backups, then watch CPU, memory, connection count and p95 latency for a month before resizing.
Heavy video should be served from a CDN or YouTube, not from the API server. Load-test with your real numbers before a large rollout; no load test was run as part of this hardening.
