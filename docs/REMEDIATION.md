# Production-readiness pass: what was found, what was changed, what is left

This answers the senior-management report ("FastSewa Training App — Senior Management Report", 10 October 2026). Section 2 follows the report's own lists, so each
finding there has an answer here. Section 3 lists what turned up while fixing. Sections 4 to 7 say what was checked, what could **not** be checked from here, and what only you can do.
Version 3.0.0; the file named in each row is where to look. The full history is in [CHANGELOG.md](../CHANGELOG.md).

**In one paragraph.** All eight launch blockers, all eight security findings and every "fix before scale" row of the report are fixed in code and covered by automated
tests (353 pass). The deployment, backup, nginx and CI files were rebuilt and tested as far as a machine without Docker, a phone or store accounts allows.
What remains is mostly **yours**: real accounts and addresses (section 6), content your safety officer has approved, legal review, and tests on real phones and under real load (section 5).
Two product gaps I found late are *not* built (section 7): asking existing learners to accept an updated privacy notice, and creating learner accounts by staff.

## 1. Status at a glance

| Report list | Items | Status |
|-------------|-------|--------|
| Launch blockers | 8 | All 8 fixed |
| Security and data protection ("What must be fixed") | 8 | All 8 fixed; two risks accepted and documented (staff have no second factor, one-time passwords do not expire) |
| Fix before scale | 9 | All 9 fixed or replaced; log shipping, monitoring and error tracking need your accounts |
| Operational readiness | 7 | Built (health check, shutdown, migrations, backups, release pipeline); alerts and a central log store are yours to connect |
| DPDP duties | 8 | The software supports them (consent record, export, erase, audit log, grievance contact settings); the notice, contracts, retention and legal judgement are yours: [DPDP-CHECKLIST.md](DPDP-CHECKLIST.md) |

## 2. The report, item by item

### Launch blockers

| # | Report | What changed | Where | Checked by |
|---|--------|--------------|-------|------------|
| 1 | Module screen called a progress route that did not exist; no module with a quiz could be finished | The app uses the real routes. Lessons show as done, and the quiz unlocks when the module's required lessons are done. The server decides, not the phone | `server/services/progress.ts`, `quiz.ts`, `client/src/screens/Module*` | `learning.test.ts`; flows run in a browser build of the app |
| 2 | Certificate download read the PDF as JSON and sent no sign-in | The PDF comes through a signed link that expires in 5 minutes; **Share** and **Download** use the phone's own sheets. Hindi names print correctly (Noto Sans and Noto Sans Devanagari are embedded); every certificate has a QR code to a public check page | `server/services/certificate.ts`, `server/routes/certificates.ts`, `verify.ts` | `certificate.test.ts`; PDFs with English, Hindi, mixed, emoji and very long names rendered and looked at |
| 3 | One shared rate limit refused everyone; video saves used up the quota | `TRUST_PROXY` defaults to 1 in production (`true` is refused); limits count per signed-in person (300 a minute), sign-in per username (8 failures in 15 minutes) and per address (60), so a crew on one Wi-Fi is not locked out; progress is reported every 10 seconds and only genuine watching counts; nginx has a flood guard that is generous on purpose | `server/middleware/rateLimit.ts`, `server/configLoader.ts`, `nginx/fastsewa.conf` | `rateLimit.test.ts`, `config.test.ts`, 19 live nginx assertions |
| 4 | Admin console did not load; forms sent values the API refused | Rebuilt as a precompiled React app served by the API: no CDN, no in-browser compiler, strict Content-Security-Policy. Forms send only filled fields; a thumbnail is optional; video, text and image lessons can be created; quizzes can be edited and deleted; lists are paged | `admin/src`, `scripts/build-admin.mjs`, `server/routes/admin/*` | `admin.test.ts`, `admin-static.test.ts`; flows run in a real browser |
| 5 | Mobile build set-up broken | The uninstalled `expo-router` plugin is removed; the icon, splash and notification images exist (generated from the console's mark: replace them); Babel and Metro configs corrected; `expo-notifications` and the other Expo packages are on the versions SDK 54 expects (run `npx expo-doctor` once with internet access to confirm); the entry (`index.js`) registers the app. **The EAS project id is still a placeholder: `eas init` (section 6)** | `app.json`, `babel.config.js`, `metro.config.js`, `client/assets/images`, `scripts/check-release-config.mjs` | The Android and web bundles export; `npm run check:release` refuses placeholders |
| 6 | Push registration ran before sign-in | The app registers after sign-in (and after a forced password change), many phones per person; addresses that Expo reports as dead are switched off; broadcast is limited to 10 an hour | `client/src/lib/push.ts`, `server/services/notification.ts` | `auth.test.ts`; **not tried on a real phone** |
| 7 | Fallback signing secret; published default logins | In production the API will not start without a strong `JWT_SECRET`, a real https `PUBLIC_BASE_URL`, no disabled rate limits; no default accounts exist; the seed refuses production; the first admin is made with `npm run create-admin` and must change the one-time password | `server/configLoader.ts`, `scripts/seed.ts`, `scripts/create-admin.ts` | `config.test.ts` (18 cases) |
| 8 | Set-up steps could not run from the production image | The image holds the migrations; the entry point applies them (one at a time, under a database lock) before the API starts; `npm run db:migrate` works the same way elsewhere | `Dockerfile`, `docker-entrypoint.sh`, `server/migrate.ts` | `migrations.test.ts`; the image itself could **not** be built here |

### Security findings

| Report | Now |
|--------|-----|
| Fallback signing secret (High) | Start-up refuses it ([#7](#launch-blockers)). Reset codes and download links use keys derived from the secret |
| Published default logins (High) | None exist; the console's sign-in page no longer shows any |
| Admin page scripts from a CDN, tokens in local storage, no CSP (Medium) | Own scripts only under a strict policy; the short-lived access token lives in memory and the refresh token in `sessionStorage` (it ends with the tab); source maps are not published in production |
| Database certificate unchecked (Medium) | Verified by default for any non-local host (`DATABASE_SSL=verify`, with `DATABASE_SSL_CA` for a private authority); `require` is a conscious choice |
| Open sign-up; content visible without enrolment or publication (Medium) | `REGISTRATION_MODE` is `open`, `code` or `closed`; courses must be published, and learners must be enrolled for lessons and quizzes; unpublished and archived courses are invisible to learners |
| Reset codes in logs (Medium) | Never logged. Without SMTP the learner is told to ask a trainer; only a development run prints the code |
| Dependency flaws (Medium) | The API's production dependencies are updated (proxy-addr, nodemailer, compression, qs and others); `npm audit --omit=dev -w server` reported no known vulnerabilities on 24 October 2026 and CI fails on high or critical ones. The remaining advisories (11 in the whole repository, 6 of them high) are in Expo's build tooling (`@expo/cli`, `node-forge`, `image-size`, `postcss`): they run on developers' machines and in EAS, not in the API |
| Uploads: client-declared type, one size limit, S3 ACL (Low) | The file's own first bytes are checked against what was declared; separate image and video limits; the S3 path no longer asks for ACLs (use a bucket policy, [DEPLOYMENT.md](../DEPLOYMENT.md)); uploads are served with `nosniff` and a sandbox policy |

### Fix before scale

| Report | Now |
|--------|-----|
| Whole files in server memory; Cloudinary free-plan limit; S3 ACL | Browsers upload straight to S3 or Cloudinary with short-lived signed links; the local-disk option streams to disk; `MAX_VIDEO_MB` (500) and `MAX_IMAGE_MB` (10) are enforced |
| Sign-in CPU | scrypt from Node's own crypto, off the main thread, at most 3 at once with a bounded queue; about 95 ms each on a 2-vCPU test machine. Old bcrypt hashes are upgraded at the next sign-in |
| Progress integrity | Saving a position never un-completes a lesson; enrolment is checked; one certificate per person and course (unique index, issued inside a transaction) |
| Training integrity | The app cannot mark a lesson done (the Tasks tab is read-only); video needs 70 % of genuine, continuous watching measured on the server, text 5 seconds; quiz answers and explanations are withheld until the quiz is passed; 10 attempts per 24 hours; pass mark per quiz |
| Certificates | Hindi font embedded, QR code, public check page at `/verify/<number>`, revoke and reinstate with a reason. The PDF itself is **not** digitally signed (tell employers to verify through the page) |
| Operations | `/api/health` (is it alive) and `/api/health/ready` (can it reach the database; answers 503 while shutting down), graceful shutdown, request ids in every log line and error body, backups and restores with tests, runbook. **Uptime alerts, error tracking and log shipping need your accounts** |
| Data protection | Consent and age confirmation at registration, data export, self-service and admin erasure, audit log of every admin write, `SUPPORT_EMAIL` / `SUPPORT_PHONE` and notice links in the app |
| Admin scale | Learner lists are paged (page and page size); the CSV export streams in stable pages, so 50,000 people never sit in memory; courses with learner records are archived, not deleted (`COURSE_HAS_RECORDS`) |
| Content display | Lessons render a safe subset of Markdown; the Search screen is reachable from the Learn tab; text follows the phone's font-size setting up to a set limit, and the smallest caption is 13 px (it was 11) |

### Operational readiness

| Report said missing | Now |
|---------------------|-----|
| Monitoring and alerts | Health endpoints and a `scripts/ops/check-deploy.sh` probe; the runbook says what to alert on. You connect the uptime monitor and error tracker |
| Database health check | `/api/health/ready` |
| Backups | `scripts/ops/backup-db.sh` (encrypted, checksummed, pruned) and `restore-db.sh`; a monthly restore drill in the runbook. **Copy backups off the server** |
| Releases that ignore failures | `.github/workflows/ci.yml` (types, lint, tests on PostgreSQL 16, build, audit, app bundle, image build and smoke test) and `deploy.yml` (a tag builds the image, publishes it, deploys through your hook and waits for the new version to answer; a failure fails the run) |
| Schema changes by hand | Applied at start-up by the entry point |
| Logs without user or request id | One JSON line per request with a request id (also sent to the app in every error and shared with nginx); no query strings, no secrets. Retention and a log store are yours ([DPDP-CHECKLIST.md](DPDP-CHECKLIST.md)) |
| Shutdown | SIGTERM: readiness goes to 503, 5 s to drain, up to 25 s for requests, exit 0 |

### "Not in the product today"

| Report | Now |
|--------|-----|
| Offline study (course list only) | The last data you saw (courses, progress, certificates) is kept on the phone and shown offline. Lessons you never opened and videos still need a connection |
| Quiz editing | Quizzes can be edited and deleted in the console |
| Reports and exports | Learner list as CSV (formula-safe), certificate lookup, progress per learner, dashboard |
| Error tracking, metrics | `setErrorReporter` is the single place to connect one ([MOBILE-RELEASE.md](MOBILE-RELEASE.md)); nothing is installed |
| Payments, phone-OTP, single sign-on | Not built, not needed for the pilot |

## 3. Found while fixing

Things the report did not list. **F** = fixed, **O** = open (see section 7).

| | Finding |
|-|---------|
| F | New advisories appeared in body-parser, multer and zod while this pass was being finished, which would have turned the CI audit gate red on its first run: updated to body-parser 2.4, multer 2.5 and zod 4.6.7 (zod 3 to 4 needed a change in two small helpers only; all tests pass; zod 4's own error wording now appears in the rare server-side validation message) |
| F | CSV export paged by a key that repeated rows |
| F | The old app never handled "you must choose a new password" |
| F | The old YouTube watch tracking (injected JavaScript) could never have worked; replaced by a player the app controls and server-side watch time |
| F | The old push registration sent a field the API rejected |
| F | The old Tasks screen let a learner tick lessons complete (the server refuses it now, the screen is read-only) |
| F | The old certificate link could not carry a sign-in; now a signed 5-minute link |
| F | Sign-in tokens were stored in AsyncStorage; now Keychain / Keystore |
| F | The server returned the raw certificate database row; now a four-field `IssuedCertificate` |
| F | `babel-preset-expo` and `babel.config.js` problems; a `metro.config.js` alias that did nothing; `@expo/vector-icons` imported from its root added about 4 MB to the bundle |
| F | The main button was 2.84:1 contrast (new palette passes); input borders and the dark progress bar were under 3:1 |
| F | A video of 4 seconds or less could never reach its completion threshold |
| F | A disabled button was not exposed as disabled on the web build; tab-bar labels were clipped |
| F | The sample lesson used a Markdown table the renderer does not support, a duplicate heading, and every quiz answer was "B"; sample courses are now titled "(Sample)" |
| F | The API's production dependencies had critical and high advisories (proxy-addr, nodemailer, compression, qs) |
| F | nginx limited sign-ins to 5 a minute per address (a shared Wi-Fi would be locked out), served `/admin` and `/uploads` from paths that do not exist, repeated headers, and forwarded a broken `Connection: upgrade` |
| F | The old deploy workflow ignored failed deploys (`continue-on-error`) and used Docker Hub and Render secrets |
| F | README and DEPLOYMENT referred to `db:push`, `admin/index.html` and `Admin@1234`, none of which exist or should |
| F | The development EAS profile hard-coded `http://localhost:5000` (the app now finds the API by itself) |
| F | Duplicate `env` key in the start-up log; `pg_restore` needed an explicit `--dbname` |
| F | `PUBLIC_BASE_URL` left at `example.com` or `localhost` would have printed dead links on every certificate: production refuses it |
| F | The admin console shipped source maps; now off in production |
| F | Course addresses (slugs) typed in the console could end with a hyphen |
| F | The console's media preview fetched hand-typed addresses; it no longer does |
| F | Staff passwords need 12 characters (learners 8); one-time passwords are 16 characters for staff, 10 for learners |
| O | Registration answers "e-mail already registered" (account enumeration, low risk) |
| O | One-time passwords never expire until used (recommend about 72 hours) |
| O | Sign-ins and failed sign-ins are not in the audit log (request logs only) |
| O | The refresh limit is per address (300 per 15 minutes); a site with hundreds of phones behind one address needs it raised in `server/middleware/rateLimit.ts` |
| O | The app does not show request ids to users; staff find them in logs |
| O | Uploaded lesson media is public to anyone with the long random address |
| O | The certificate PDF is not digitally signed; no multi-factor sign-in for staff |
| O | **`CONSENT_VERSION` is only recorded. Learners are not asked to accept an updated notice, and accounts created before this version have no consent record.** The settings comments said otherwise until this pass; corrected |
| O | **`REGISTRATION_MODE=closed` stops all self-registration, but there is no screen for staff to create learners** (only staff accounts). Use `code` while enrolling |

## 4. How it was checked

* **353 automated tests pass** (API on PostgreSQL 16, shared rules, app logic, admin console); the TypeScript check for the app, the API and the console is clean; ESLint reports no warnings.
* **The app's screens were exercised in a browser build** (Expo web with Playwright): register, sign in, forced password change, learn, quiz, certificate, Hindi and English, dark mode, offline, a failed video, and an accessibility scan (axe). The Android bundle exports.
* **The API ran as built** (`dist/`): start-up refusals, migrations on an empty and on an old database, graceful shutdown, sign-in under load, upload paths, PDF output.
* **nginx**: the configuration was loaded into a live nginx and 19 assertions run against it (limits, headers, JSON error pages, closed `/api/health/ready`, streaming uploads).
* **Backups**: real `pg_dump` and `pg_restore` round trips including encryption, a tampered file, wrong password, refusal to restore into a non-empty database, pruning, and the "sign everyone out" SQL (rolled back).
* **Files**: `docker compose config`, `actionlint` and `yamllint` on the workflows, `shellcheck` on every script under `scripts/ops`.
* **Dependencies**: `npm audit --omit=dev -w server` reports nothing (24 October 2026); the whole repository still reports 11 advisories in Expo's build tooling. New advisories appear all the time: a red CI audit step usually means `npm audit fix` and a re-run.

## 5. Not verified here

Be careful to treat these as unknown, not as passed.

* **The Docker image was never built, and the compose file and `--compose` backup modes never ran** (no Docker daemon, registries blocked). The Dockerfile's stages were simulated by hand and the compose file validated, nothing more.
* **The GitHub workflows never ran.** They pass the linters only.
* **No real phone.** Video playback in the YouTube and hosted-video players, push notifications, the keystore, Android back-gestures, fonts at the largest size, and iOS behaviour were not seen on a device. Learners who watch at 2x speed may not reach 70 %. YouTube error 153 (embeds that need a referrer) is a known risk for some videos.
* **No load test and no penetration test.** The capacity numbers are the report's estimates, plus one measurement: scrypt about 95 ms per hash (8 in parallel about 416 ms on 2 vCPUs).
* **No real SMTP server, S3 bucket or Cloudinary account.** SMTP was tested against a local sink. For S3 and Cloudinary the tests cover the policy (allowed hosts, sizes, file types by their first bytes), but no request was ever sent to either service.
* **iOS**: the `aps-environment` entitlement value in a finished build, and App Store requirements, are unchecked.
* **iCloud backs up the app's AsyncStorage on iOS** (course lists, last-seen progress); tokens are in the Keychain. Decide if that matters for your notice.
* **Legal**: [DPDP-CHECKLIST.md](DPDP-CHECKLIST.md) is an engineering view. Nothing here has been seen by a lawyer.
* **Content**: the seed courses are samples. A safety officer or subject-matter expert must approve real content, and a native Hindi speaker must review the Hindi text.

## 6. Needs you

- [ ] **EAS**: `eas init` and commit the project id; real `EXPO_PUBLIC_API_URL` values in `eas.json`; confirm the app id `com.fastsewa.training` before the first store upload ([MOBILE-RELEASE.md](MOBILE-RELEASE.md)).
- [ ] **Secrets and `.env`**: `JWT_SECRET`, `DATABASE_URL`, `PUBLIC_BASE_URL`, `REGISTRATION_CODE`; stored in a password manager, not in git.
- [ ] **E-mail**: an SMTP provider if learners should reset passwords themselves (otherwise trainers issue one-time passwords).
- [ ] **Media**: S3 or Cloudinary (with the bucket's CORS rule), or use YouTube links only.
- [ ] **Push**: Firebase `google-services.json` and the FCM key (Android); Apple key (iOS).
- [ ] **Brand**: your logo in place of the generated images (`scripts/make-brand-assets.mjs`).
- [ ] **Content**: real, approved courses and quizzes, Hindi reviewed; remove or unpublish the "(Sample)" courses.
- [ ] **Legal**: privacy notice, terms, grievance contact, processor contracts, retention and log periods, the decision on under-18s and on consent versus employment.
- [ ] **Operations**: uptime monitor; error tracking (`setErrorReporter`); log shipping and retention (CERT-In 180 days; the DPDP Rules ask one year from May 2027, counsel to confirm); backups copied off the server; the first restore drill.
- [ ] **Releases**: GitHub environment `production`, the `DEPLOY_HOOK_URL` secret and `API_URL` variable (or deploy by hand), and a first `eas build:version:set` for remote build numbers.
- [ ] **Tests on real phones** (section 4 of [MOBILE-RELEASE.md](MOBILE-RELEASE.md)) and a load test of sign-in and video progress at your expected size; a penetration test before a large rollout.
- [ ] **Two small knobs for big sites**: raise the refresh limit if hundreds of phones share one address; run `expo export --clear` (or `expo start --clear`) after changing `EXPO_PUBLIC_API_URL`, because Metro caches the old value.
- [ ] **Large tables**: the migrations create indexes without `CONCURRENTLY`; on an existing database with millions of rows, run them in a quiet hour.

## 7. Open items, in the order I would do them

1. **In-app "accept the updated notice" screen** (and consent for accounts that predate it): a flag on `/auth/me`, one endpoint, one screen, as the forced password change works. About a day with tests.
2. **Staff-created learner accounts** (one-time password, forced change, consent at first sign-in), so `REGISTRATION_MODE=closed` is useful on its own.
3. **One-time passwords that expire** after about 72 hours; **sign-ins in the audit log**.
4. **Multi-factor sign-in for admins** (TOTP).
5. **Private video** (signed URLs or an unlisted host) if course material is not meant to be public.
6. **Automatic retention**: an inactivity report and erase job per your retention rule.
7. **Digitally signed certificate PDFs**, if employers will rely on the PDF alone.
8. **Device test automation** (Maestro or Detox) so the real-phone checklist is repeatable.
