# Runbook

For the person who runs FastSewa day to day. Commands assume the single-server setup from
[DEPLOYMENT.md](../DEPLOYMENT.md) (path A) and are run in `/opt/fastsewa`; on a platform (path B) use its dashboard and shell for the same things.

## 1. Cheat sheet

```bash
cd /opt/fastsewa
docker compose ps                                  # is the API running, and "healthy"?
docker compose logs -f --tail 100 api              # follow the API log (Ctrl-C leaves it running)
docker compose restart api                         # restart: it drains for 5 s, so allow about 15 s
scripts/ops/check-deploy.sh https://api.yourdomain.com       # what a learner's phone sees: health, headers, certificate
scripts/ops/backup-db.sh                           # back up the database now
scripts/ops/psql.sh                                # database shell on the live data: look, do not edit
docker compose exec api node dist/create-admin.js --reset <username>     # new one-time password for any account
```

## 2. What healthy looks like, and what each alarm means

| Signal | Healthy | If not |
|--------|---------|--------|
| `GET /api/health` (public) | `200 {"status":"ok","version":"…"}` | The API process or the server is down, or nginx cannot reach it. `docker compose ps`, then the log. Learners see "can't reach the server". |
| `GET /api/health/ready` (from the server: `curl -s http://127.0.0.1:5000/api/health/ready`) | `200 "ready"`, database `latencyMs` in single digits to low tens | `503 "unavailable"`: the database cannot be reached (provider outage, wrong or rotated password, connection limit, network). The API keeps running and recovers by itself when the database returns. `503 "draining"`: it is shutting down for a restart or a deploy; normal for a few seconds. |
| nginx answers `503` JSON with `SERVICE_UNAVAILABLE` | never | The API container is down or restarting. |
| Many `429` | a few | From nginx (`RATE_LIMITED` with a 32-character `requestId`): one address is flooding. From the API (`requestId` with dashes): a login, registration or reset limit was hit: see section 5. |
| `server busy` (`SERVER_BUSY`, 503) | never | More sign-ins waiting than the machine can hash: a very large shift start. Raise `PASSWORD_HASH_CONCURRENCY` and/or the CPU count ([DEPLOYMENT.md](../DEPLOYMENT.md), Sizing). |
| Disk above 80 % | well below | Docker logs are capped (10 MB × 10 per container), so look at backups (`/var/backups/fastsewa`), `docker system df` and, with local media, the uploads volume. |
| Certificate under 21 days from expiry | about 60 days left | `sudo certbot renew` and read its error; the timer should have renewed it at 30 days. |
| No backup file from last night | a new file every day | `tail /var/log/fastsewa-backup.log`; then section 4. |

Set the uptime monitor on `/api/health`, and make the backup job report to a dead-man's-switch service
(`BACKUP_AFTER_COMMAND='curl -fsS https://hc-ping.example/<your id>'`) so a *missing* backup also raises an alarm, not only a failing one.

## 3. Reading the logs

The API writes JSON, one line per event, to the container log. Successful requests to `/api/health` and static files are not logged; every API request is.

```bash
docker compose logs --since 1h api | grep '"level":"error"'              # server errors in the last hour
docker compose logs --since 1h api | grep '"status":5'                   # every 5xx answer
docker compose logs --since 1d api | grep '<user id>'                    # one learner's requests (find the id with scripts/ops/psql.sh)
docker compose logs api | grep '<request id>'                            # one request, from an error body or the X-Request-Id header
```

Useful fields: `reqId`, `method`, `route` (the route pattern, never the raw URL or query string, because signed links carry a secret there), `status`, `ms`, `ip`, `userId`.
nginx's own line has the same id as `rid=` in `/var/log/nginx/fastsewa.access.log`, so a slow request can be followed from the edge into the API.
Passwords, reset codes and tokens are never logged. In development the reset code is printed to the console; in production it is not.

Locate a learner's problem from what they can tell you (their username and roughly when). The app does not show them a reference number.

## 4. Backups and restores

* **Daily:** `scripts/ops/backup-db.sh` from cron ([DEPLOYMENT.md](../DEPLOYMENT.md), step 8). It writes a checked, compressed dump with a checksum, optionally encrypts it, optionally copies it off the server, and prunes old files only after a good new one exists.
  With a managed database also keep the provider's own backups and point-in-time recovery switched on: they usually give a smaller data-loss window than a nightly dump.
* **What a backup contains:** everything, including learners' names, phone numbers and e-mail addresses. Treat the files as personal data: encrypted disk or bucket, few readers, deleted on schedule.
* **Local media storage:** the uploads volume is *not* in the database backup. Back up `docker volume inspect fastsewa_uploads` (its mount point) as well, or use S3/Cloudinary, which have their own durability.

### Restore drill (every month, 15 minutes)

A backup nobody has restored is a hope. Restore the newest one into a scratch database and look at it:

```bash
# 1. an empty scratch database (on the same provider, or any PostgreSQL 16)
createdb -h <host> -U <user> fastsewa_drill
# 2. restore the newest backup into it (the password goes in the URL; use RESTORE_DATABASE_URL to keep it out of your shell history)
RESTORE_DATABASE_URL='postgresql://<user>:<password>@<host>:5432/fastsewa_drill' \
  scripts/ops/restore-db.sh /var/backups/fastsewa/fastsewa-<newest>.dump
# 3. compare the row counts it prints with production (scripts/ops/psql.sh), then drop the scratch database
dropdb -h <host> -U <user> fastsewa_drill
```

The restore script refuses to write into a database that already has tables, verifies the checksum first, and handles encrypted backups (`BACKUP_PASSPHRASE_FILE`). Write the date of the drill and the time it took in your log.

### Restoring for real

1. Stop writes: `docker compose stop api` (learners see "can't reach the server"; they lose nothing already saved).
2. Create a **new** empty database, restore the backup into it with `scripts/ops/restore-db.sh`.
3. Put its URL in `DATABASE_URL` in `.env`, `docker compose up -d`, run `scripts/ops/check-deploy.sh`.
4. Tell trainers what time the data goes back to: anything learners did after the backup is gone. Learners' phones keep their last-seen data, and the app saves progress again as they continue.

The data-loss window is the time since the last backup (or, with point-in-time recovery, a few minutes). If that is too long for the business, back up more often.

## 5. Routine tasks

| Task | How |
|------|-----|
| Add a trainer or admin | Admin console → Staff → New. A one-time password is shown **once**; give it to the person safely. They must change it at first sign-in. |
| A learner forgot their password | Admin console → Learners → the learner → Reset password (shown once, must be changed at next sign-in). If SMTP is set up they can also use "Forgot password". |
| The only admin is locked out | `docker compose exec api node dist/create-admin.js --reset <username>`: a new one-time password; every session of that account is signed out. |
| Someone left | Staff or Learners → Deactivate. They are signed out and cannot sign in; their history stays. "Erase this learner's data" (on the learner's page; you type the username to confirm) removes the personal data permanently: use it for deletion requests. |
| Change the registration code | Edit `REGISTRATION_CODE` in `.env`, `docker compose up -d`. Existing learners are not affected. |
| Publish or change a course | Admin console → Courses. Draft first, publish when reviewed. Learners already enrolled keep their progress. |
| A certificate was issued by mistake | Admin console → Certificates → Revoke. `/verify/<number>` then says "revoked". Reinstate is the undo. |
| Send everyone a push message | Admin console → Broadcast (limited to 10 an hour). |
| A learner asks for their data, or to be deleted | In the app: Profile → export or delete my account (self-service). Or an admin does it from the console. Record the request and date ([DPDP-CHECKLIST.md](DPDP-CHECKLIST.md)). |
| Export a report | Admin console → Learners → Export CSV. Every export is written to the audit log; the file holds personal data, so delete it when done. |
| "Too many requests" for a learner or crew | Per-username limit: 8 wrong passwords in 15 minutes locks *that username* for the rest of the window (a typo never counts against anyone else). Per address: 60 wrong passwords in 15 minutes. Wait it out, or, when `REDIS_URL` is not set (counters are in memory), restart the API (`docker compose restart api`) to clear them if you are sure it is a mistake. |
| Rotate the JWT secret | Put the new value in `JWT_SECRET` and the old one in `JWT_SECRET_PREVIOUS`, `docker compose up -d`, and remove `JWT_SECRET_PREVIOUS` after an hour. Nobody is signed out either way: a phone whose access token no longer verifies swaps it for a new one using its refresh token (those are random values stored hashed in the database, not signed with the secret). Listing the old secret just makes that happen gradually instead of all at once, which matters for a big crew behind one address. Password-reset codes (30 minutes) and certificate download links (5 minutes) issued before the change stop working. If the old secret leaked, do not list it as previous. |
| Change a setting | Edit `.env`, `docker compose up -d` (it recreates the container with the new values; no rebuild). |

Every change an admin makes in the console is written to the audit log (Audit page: who, what, when, from where). Sign-ins are not in the audit log: they are in the request log (`/api/v1/auth/login`, `status` 200 or 401).

## 6. Incidents

First, stop the damage; then find out what happened; then fix it; then write it down. Keep notes with times as you go.

| What happened | Do this |
|---------------|---------|
| **The service is down** | `docker compose ps`, `docker compose logs --tail 200 api`. A start-up failure prints a list of what is wrong with the settings. Try `docker compose up -d`. If a deploy just happened, go back to the previous version ([DEPLOYMENT.md](../DEPLOYMENT.md), "Updating, and going back"). |
| **The database is unreachable** | Check the provider's status page, then the connection limit and the password. The API recovers on its own. Do not restart the API in a loop. |
| **The database is damaged or data was deleted by mistake** | Section 4, "Restoring for real". Stop the API first so nothing new is written on top. |
| **The server is lost** | New server, DEPLOYMENT.md steps 1 to 6 with the same `.env` (keep a copy in the team's password manager), point DNS at it, restore local media if you use it. The database is separate and is not affected. |
| **A secret leaked** (`.env` committed or shared, a laptop lost) | JWT secret: rotate as above and **do not** list the old one in `JWT_SECRET_PREVIOUS`; tokens forged with it stop working at once. Database password, SMTP password, S3 or Cloudinary keys: rotate them at the provider, update `.env`, `docker compose up -d`. Then read the audit log and request log for the period. If refresh tokens or the database may have been copied, also sign everyone out (below). |
| **An admin or trainer account is compromised** | Deactivate it, reset it, review the audit log for what it did, revoke certificates it should not have issued, check for staff accounts it created. |
| **Personal data may have been exposed** | Treat it as serious until shown otherwise. Preserve logs and backups; do not delete anything. Under India's DPDP Act and Rules the Data Protection Board and each affected person have to be told about a breach, and CERT-In has to be told of certain incidents within 6 hours of noticing them. Which duty applies to you, to whom and by when is for your lawyer: involve them straight away ([DPDP-CHECKLIST.md](DPDP-CHECKLIST.md)). |
| **Someone is hammering the API** | nginx already flood-limits per address. Find the address in `/var/log/nginx/fastsewa.access.log`, block it: `sudo ufw deny from <address>`. For a distributed attack put a CDN/WAF in front (and set `TRUST_PROXY` to match). |

### Signing everyone out

For suspected theft of tokens or a copied database. Learners keep their data and sign in again with their passwords (a crew should be told first); running API containers notice within about 10 seconds.

```bash
scripts/ops/psql.sh <<'SQL'
begin;
update refresh_tokens set revoked_at = now() where revoked_at is null;
update users set token_version = token_version + 1;
commit;
SQL
```

## 7. Maintenance calendar

| When | What |
|------|------|
| Weekly | Look at the pull requests Dependabot opened; merge the security ones within days. `npm audit --omit=dev --workspace=server` should say 0. Skim the error log. |
| Monthly | Restore drill (section 4). Review the Staff list (remove people who left) and the audit log. Check disk, certificate expiry and that the off-server copies of backups exist. Update the server: `sudo apt update && sudo apt upgrade`, reboot in a quiet hour, check `docker compose ps`. |
| Each release | Back up first, deploy a tag, `scripts/ops/check-deploy.sh … --expect-version`, watch the log for ten minutes. |
| Quarterly | Rotate secrets if your policy says so. Test the "server lost" plan on a spare machine. Review the privacy notice, retention periods and the content of courses with the safety officer. |
| Yearly | Domain renewal, Apple and Google developer fees, store review of the app's data-safety answers, a penetration test or at least a review of [SECURITY.md](SECURITY.md). |

## 8. Things to know

* **Data protection settings:** `CONSENT_VERSION` is stored with each new account (which notice they accepted); raising it does **not** ask existing learners again ([DPDP-CHECKLIST.md](DPDP-CHECKLIST.md) says what to do instead). Learners can export or delete their own data from the profile screen.
* **Housekeeping runs by itself:** expired sign-in sessions and abandoned upload tickets are deleted every six hours. Audit log rows and completed progress are kept; decide a retention period for them ([DPDP-CHECKLIST.md](DPDP-CHECKLIST.md)).
* **Migrations:** run automatically at container start under a database lock. A failed migration stops the container instead of starting an API that expects a different schema; the log says which one. Migrations only ever add (new columns and tables first, removals a release later). Indexes on a very large table should be created `CONCURRENTLY` by hand first: the shipped migrations build indexes normally, which is fine at the size this app has today.
* **Open items you should know about** (in [REMEDIATION.md](REMEDIATION.md)): one-time passwords do not expire until used, the audit log does not record sign-ins, and the refresh-token limit is per address (a site with more than a few hundred phones behind one address needs it raised in `server/middleware/rateLimit.ts`).
