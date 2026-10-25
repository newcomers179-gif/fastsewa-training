# Security notes

How FastSewa is protected, what is still open, and what the people who run it have to do. It describes the code as shipped; the file named
in each row is where to look, and most rows are covered by automated tests (`npm test`).
**No penetration test has been done.** Have one done by someone independent before a large launch.

## 1. What is being protected, and from whom

| Asset | Why it matters |
|-------|----------------|
| Learners' personal data: name, username, phone number, optional e-mail, language, progress, quiz attempts, certificates | Personal data under India's DPDP Act ([DPDP-CHECKLIST.md](DPDP-CHECKLIST.md)); a leak harms real people |
| Staff accounts (admin, trainer) | An admin can read everyone's data, change courses, revoke or issue certificates |
| Certificates | Employers and site managers rely on them being genuine |
| Course content | Safety training: wrong content is a safety problem, not just a data problem |

Adversaries considered: a learner who wants a certificate without doing the training; someone on the internet guessing passwords or scraping;
a stolen or shared phone; a staff account whose password leaked; someone who obtains a copy of the database or of `.env`.

## 2. Controls in place

| Area | What the code does | Where |
|------|-------------------|-------|
| **Passwords** | scrypt (N=2^15, 32 MiB, about 100 ms), at most 3 hashes at once with a bounded queue so a login flood cannot exhaust the CPU; old bcrypt hashes are upgraded at the next sign-in. Learners need 8 characters, staff 12; a deny-list refuses the common ones and any password this project ever shipped; maximum 128. | `server/auth/password.ts`, `shared/validation.ts` |
| **One-time passwords** | Random, shown once; the account must choose its own password before it can do anything else (the API answers `PASSWORD_CHANGE_REQUIRED` to every other call, and both the app and the console show the change screen). Staff ones are 16 characters, learners' 10. | `server/services/accounts.ts`, `server/middleware/auth.ts` |
| **Sessions** | 15-minute access tokens (HS256 with pinned algorithm, issuer, audience and type). Refresh tokens are 256 random bits, only their SHA-256 is stored, and they rotate on every use; replaying an old one revokes the whole session family (a 30-second grace covers a lost response). Passwords change, deactivation and role changes invalidate every access token at once (`token_version`). Sessions end after 90 days regardless. | `server/auth/tokens.ts`, `server/auth/sessions.ts` |
| **Tokens on the phone** | Android Keystore / iOS Keychain through `expo-secure-store` (the web build falls back to browser storage). | `client/src/lib/storage.ts` |
| **Authorization** | Role checked on the server for every admin route; learners only ever read and write their own records; unpublished and archived courses are invisible to them; quiz answers and explanations are not sent before the quiz is passed. | `server/middleware/auth.ts`, `server/routes/admin/*`, `server/services/quiz.ts` |
| **Input** | Every body is validated with a schema, JSON size limits per route group (20 KB, 50 KB, 1 MB), database access through parameterised queries, CSV exports neutralise spreadsheet formulas, lesson text is rendered by a small allow-list Markdown renderer (no HTML, only `http(s)`, `mailto:` and `tel:` links), and media links must come from an allow-list of hosts. | `server/validators.ts`, `shared/validation.ts`, `shared/markdown.ts`, `server/services/media.ts` |
| **Learning integrity** | Completion is decided by the server: video needs 70 % of genuine, continuous watch time measured from heartbeats (skipping ahead adds nothing); text needs 5 real seconds; the app cannot mark a lesson done by itself; quizzes unlock only after the lessons, with at most 10 attempts per 24 hours; a certificate is issued once, inside a transaction, so concurrent requests cannot double-issue it. | `server/services/progress.ts`, `server/services/quiz.ts` |
| **Certificates** | Numbers like `FSWA-K7QX-3M9B-2TDP` (12 random characters from a 31-letter alphabet, about 59 bits), a public verification page behind a rate limit (60 a minute per address), revocation with a reason, and PDF downloads through a signed link that expires in 5 minutes (a tampered signature gets 401). | `server/services/certificate.ts`, `server/routes/verify.ts`, `server/routes/certificates.ts` |
| **Transport** | HTTPS only in production (`PUBLIC_BASE_URL` must be https and not a placeholder, HSTS for a year, store builds refuse an `http://` API address, database TLS is verified by default for any non-local host). | `server/configLoader.ts`, `client/src/lib/apiUrl.ts` |
| **Browser** | The admin console runs under a strict Content-Security-Policy (own scripts only, no inline script or style, no CDN), the API answers with `default-src 'none'` and `no-store`, uploads are served with `nosniff` and a sandbox policy, CORS is an explicit allow-list (`*` is refused), referrer is not sent. | `server/app.ts`, `server/middleware/cors.ts` |
| **Abuse limits** | Signed-in traffic is limited per user, sign-in per username (8 failures in 15 minutes) and per address (60), registration 40 an hour per address, password reset 3 an hour per e-mail, and so on; counters are shared through Redis when it is configured. nginx adds a generous per-address flood guard. Limits are keyed so that a whole crew behind one site Wi-Fi is not locked out by one person. | `server/middleware/rateLimit.ts`, `nginx/fastsewa.conf` |
| **Accountability** | Every admin write (course, user, staff, certificate, export, broadcast, erase) is recorded with who, what, when and from where. Request logs carry a correlation id, never the query string, never a secret. | `server/services/audit.ts`, `server/middleware/requestContext.ts` |
| **Secrets** | Validated at start-up: a missing, short or placeholder `JWT_SECRET` stops the API in production; reset codes and signed links use keys derived from it, so a database leak alone cannot forge them; no secret is in the image (`.dockerignore`) or in the logs. | `server/configLoader.ts`, `.dockerignore` |
| **Container** | Runs as the unprivileged `node` user, read-only file system (only the uploads volume and `/tmp` are writable), all Linux capabilities dropped, `no-new-privileges`, memory and process limits, `tini` as PID 1 so shutdown signals reach Node. | `Dockerfile`, `docker-compose.yml` |
| **Supply chain** | Lockfile, `npm ci --ignore-scripts` in CI and in the image build, `npm audit` on the API's production dependencies as a build gate (zero known advisories on 24 October 2026; a new one can turn CI red without any code change: `npm audit fix`, run the tests, merge), Dependabot for npm, Docker and GitHub Actions, the API bundle only contains packages declared in `server/package.json` (the build fails otherwise). | `.github/workflows/ci.yml`, `.github/dependabot.yml`, `scripts/build-server.mjs` |
| **Privacy** | Consent version and age confirmation at registration, self-service data export and account deletion, an admin erase action, no analytics or advertising SDK in the app, the privacy notice and terms linked from the app. | `shared/schema.ts`, `server/routes/auth.ts` |

## 3. Known gaps

Be honest with yourself and your auditor about these; each says what to do.

| Gap | Risk | What to do |
|-----|------|-----------|
| One-time passwords never expire until used | A password written on paper and forgotten stays valid | Not implemented. Recommended: expire them after about 72 hours (a column and one check at sign-in), and tell trainers to hand them over in person |
| No multi-factor authentication for admins and trainers | A stolen admin password is enough | Strong password rules, rate limits and the audit log reduce it; for a launch with many staff, add TOTP for staff accounts |
| Sign-ins and failed sign-ins are not in the audit log | Investigating account takeover relies on request logs | Keep request logs for the period your counsel sets (CERT-In: 180 days; DPDP Rules: at least one year from May 2027; they hold the address and user id); alert on bursts of `/api/v1/auth/login` 401s |
| Registration says "e-mail already registered" | Someone can test whether an address has an account | Low risk; changing it costs the learner clarity. Accept or switch registration to `code` / `closed` mode |
| The refresh limit is per address (300 per 15 minutes) | A site with more than a few hundred phones behind one address could hit it after an outage or a secret rotation | Raise it in `server/middleware/rateLimit.ts`, or list the old secret in `JWT_SECRET_PREVIOUS` when rotating |
| Uploaded lesson media is public to anyone with the long random address | Not a confidentiality control | Do not upload anything private. Use unlisted YouTube links or private storage behind signed URLs if that changes |
| YouTube lessons load Google's player | Google can see playback from the learner's device | Say so in the privacy notice ([DPDP-CHECKLIST.md](DPDP-CHECKLIST.md)); the admin preview uses the no-cookie domain |
| Push notifications go through Expo and Apple/Google | Device tokens are shared with those services | Disclose it; the app only registers a token after the learner allows notifications |
| The certificate PDF is not digitally signed | A PDF can be edited; the QR code points at the live verification page | Tell employers to verify through the page or the number, never from the PDF alone |
| Backups hold all personal data | A stolen backup is a breach | Encrypt them (`BACKUP_PASSPHRASE_FILE`), keep them off the server on storage with access control, delete on schedule |
| Expo's build tooling has a few npm advisories (`@expo/cli`, `node-forge`, `image-size`, `postcss`) | They do not ship in the API, but run on developers' machines and in EAS | CI installs with `--ignore-scripts`; keep Dependabot merged; upgrade the Expo SDK on a schedule |
| Not tested by a third party | Unknown unknowns | Commission a penetration test of the API, the admin console and the mobile app before a large rollout |

## 4. Hardening checklist for the server

* SSH by key only, no root login, automatic security updates (`unattended-upgrades`), the firewall from [DEPLOYMENT.md](../DEPLOYMENT.md) (22, 80, 443).
* The database accepts connections only from the API server (provider allow-list or private network) and uses its own user with a strong password; do not reuse it anywhere else.
* S3/Cloudinary keys are scoped to the one bucket or account the API needs.
* `.env` is mode 600, owned by the deploy user, in the password manager, not in git, not in chat.
* Separate **staging** from **production**: its own database, its own `JWT_SECRET`, `REGISTRATION_MODE=closed`, and never real learners' data.
* Two people can reach the admin account recovery path (`create-admin --reset`), and both know the incident steps in [RUNBOOK.md](RUNBOOK.md).

## 5. Reporting a problem

No security contact is configured in this repository. Create one (for example `security@yourdomain`), publish it on the privacy page and in the app's support text, and decide who answers it and how fast.
