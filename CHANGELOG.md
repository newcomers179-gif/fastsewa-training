# Changelog

All notable changes. Version numbers follow `MAJOR.MINOR.PATCH`; `app.json`, `package.json` and `server/package.json` always carry the same one
(`npm run check:release` and the release workflow check it). The detail behind each item, and what is still open, is in [docs/REMEDIATION.md](docs/REMEDIATION.md).

## 3.0.0 — production-readiness release

This release answers every finding of the senior-management report of 10 October 2026. It is a **major** version: the API, the database, the admin console,
the deployment files and the mobile app were all reworked, and the app and the API must be released together.

### Database

* Migrations `0002_production_hardening` and `0003_report_and_purge_indexes`: consent and erasure columns, hashed refresh-token families, push devices, media uploads,
  audit log, certificate issue-day name and title, a unique certificate per person and course, per-lesson watch time, token versions, constraints and indexes.
  Existing databases upgrade in place (tested on a database made by the old version); on a very large table, run the index creation in a quiet hour.
* Migrations are applied by the container's entry point under a database lock, or with `npm run db:migrate`.

### API

* Production refuses to start with a missing, short or placeholder `JWT_SECRET`, a non-https or placeholder `PUBLIC_BASE_URL`, `TRUST_PROXY=true`, or disabled rate limits.
* Sessions: 15-minute access tokens, rotating opaque refresh tokens with reuse detection, 90-day maximum, sign-out on every device, forced password change after a one-time password.
* Passwords: scrypt with bounded concurrency (bcrypt hashes are upgraded at sign-in), deny-list of common passwords, 12 characters for staff.
* Rate limits per person, per username and per address, with Redis support; request ids in logs and error bodies; JSON error bodies for every failure.
* Learning rules decided on the server: genuine watch time for videos, quiz unlock after lessons, 10 attempts per 24 hours, answers withheld until passed, enrolment and publication checks.
* Certificates: Hindi and English PDFs with an embedded font and a QR code, public verification page, revoke and reinstate, signed 5-minute download links.
* Privacy: consent record, data export, self-service and admin erasure, audit log.
* Media: direct-to-storage uploads (S3, Cloudinary) or streaming to disk, type check by file content, per-kind size limits.
* Health (`/api/health`, `/api/health/ready`), graceful shutdown, readiness 503 while draining.
* Dependencies: express 5.2, multer 2.5, body-parser 2.4, nodemailer 10, zod 4.6; no known advisory in the API's production dependencies.

### Admin console

* Rebuilt as a precompiled React app served at `/admin` under a strict Content-Security-Policy (no CDN, no in-browser compiler, no default credentials).
* Courses, modules, lessons (video, text, image), quizzes (edit and delete), learners (paged, CSV export, reset, deactivate, erase), staff, certificates, audit log, broadcast, dashboard.

### Mobile app

* Fixed: module and lesson progress, the quiz unlock, certificate download and share, push registration after sign-in, forced password change, language switch, Search.
* Tokens in Keychain/Keystore; last-seen data available offline; a YouTube player the app controls; safe Markdown lessons; contrast, touch-target and font-scale fixes; English and Hindi.
* Build: valid `app.json`, generated brand images (replace them), corrected Babel and Metro config, `npm run check:release` refuses placeholders and `http://` addresses.

### Deployment and operations

* `Dockerfile` (three stages, non-root, `tini`, health check), `docker-compose.yml` (read-only file system, dropped capabilities, limits, optional local database and Redis), `nginx/fastsewa.conf` rebuilt.
* `scripts/ops`: encrypted, checksummed, pruned database backups; restore with safety checks; a post-deploy check; a `psql` helper.
* GitHub Actions: `ci.yml` (types, lint, tests on PostgreSQL 16, build, audit, app bundle, image build and smoke test) and `deploy.yml` (tagged releases); Dependabot.
* Documents: [README](README.md), [DEPLOYMENT](DEPLOYMENT.md), [RUNBOOK](docs/RUNBOOK.md), [SECURITY](docs/SECURITY.md), [DPDP-CHECKLIST](docs/DPDP-CHECKLIST.md), [MOBILE-RELEASE](docs/MOBILE-RELEASE.md), [REMEDIATION](docs/REMEDIATION.md).

### Known limits of this release

Not verified in the environment it was prepared in: the Docker image build, the compose file's runtime, the GitHub workflows, real phones, real SMTP/S3/Cloudinary,
load and penetration tests. Not built: an in-app prompt to accept an updated privacy notice, staff-created learner accounts, expiring one-time passwords,
multi-factor sign-in for staff. See [docs/REMEDIATION.md](docs/REMEDIATION.md) sections 5 to 7.

## 2.x and earlier

The version delivered for review (the report describes it). Not maintained.
