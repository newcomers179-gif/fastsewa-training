# FastSewa Training

Mobile training for construction crews: short lessons (video or text), quizzes after each module, and a
verifiable PDF certificate when a course is finished. English and Hindi. Trainers and admins follow
progress from a web console.

| Part | What it is | Where |
|------|-----------|-------|
| **Mobile app** | React Native (Expo SDK 54): learn, quizzes, certificates, profile, push notifications, last-seen data offline | `client/src` |
| **API** | Node 22, Express 5, TypeScript, PostgreSQL (Drizzle) | `server`, `shared` |
| **Admin console** | React single-page app served by the API at `/admin` (courses, learners, staff, certificates, audit log, broadcasts) | `admin/src` |
| **Certificate check** | Public page at `/verify/<number>`, reached from the QR code on each certificate | `server/routes/verify.ts` |

New to the project? Read this page, then [DEPLOYMENT.md](DEPLOYMENT.md) to put it live and
[docs/RUNBOOK.md](docs/RUNBOOK.md) to run it. What was found and fixed in the production-readiness pass, and what still
needs a decision or an account of yours, is in [docs/REMEDIATION.md](docs/REMEDIATION.md).

## Run it on your computer

You need Node 22 (20.12 or newer works), npm, and a PostgreSQL database (14 or newer; the tests run on 16).
A throw-away database in Docker is enough: `docker run -d --name fastsewa-pg -e POSTGRES_PASSWORD=dev -p 5432:5432 postgres:16-alpine`.

```bash
npm install
cp .env.example .env
```

Edit `.env` and set the database. In development nothing else is required:

```
DATABASE_URL=postgresql://postgres:dev@localhost:5432/postgres
```

Then:

```bash
npm run db:migrate          # create the tables
npm run seed                # sample accounts and courses; prints each password ONCE, so copy them
npm run admin:build         # build the admin console (the API serves it)
npm run dev                 # API on :5000 and the Expo dev server
```

* **App:** press `a` / `i` in the Expo terminal, or scan the QR code with Expo Go (push notifications need a development or store build). The app finds the API on your
  computer by itself (the address Expo shows), so a real phone on the same Wi-Fi works without any setting.
  Set `EXPO_PUBLIC_API_URL` only if the API runs somewhere else. Restart Expo with `npx expo start --clear` after changing it.
* **Admin console:** <http://localhost:5000/admin/>. Sign in with the `admin` password the seed printed.
  `node scripts/build-admin.mjs --watch` rebuilds it as you edit `admin/src`.
* **Your own admin account** (no seed needed, also how the first admin of a real deployment is made, and how a locked-out admin gets back in):
  `npm run create-admin -- jane "Jane Roy" --generate` prints a one-time password that must be changed at first sign-in.
  `npm run create-admin -- --reset jane` issues a new one.

The sample courses are titled "(Sample)": they only exist to try the app. **Replace them with material your safety
officer or subject-matter expert has approved before real use.**

## Commands

| Command | What it does |
|---------|--------------|
| `npm run dev` | API (with reload) and Expo together |
| `npm run check:types` | TypeScript for the app, the server and the admin console |
| `npm run lint` | ESLint, no warnings allowed |
| `npm test` | All tests; needs `TEST_DATABASE_URL` (below) |
| `npm run test:unit` | Only the tests that need no database |
| `npm run build` | Production API bundle (`dist/`) and admin console (`admin/dist/`) |
| `npm run db:migrate` | Apply pending SQL migrations (`migrations/`) |
| `npm run db:generate` | After changing `shared/schema.ts`: generate a new migration, then read it before committing |
| `npm run seed` / `npm run create-admin` | Sample data / accounts, see above |
| `npm run check:release` | Refuses a mobile release build that still has placeholders ([docs/MOBILE-RELEASE.md](docs/MOBILE-RELEASE.md)) |

The tests empty their tables, so they use their own database and refuse any name that does not contain `test`:

```bash
createdb fastsewa_test
export TEST_DATABASE_URL=postgresql://postgres:dev@localhost:5432/fastsewa_test
npm test
```

## How learning is tracked (rules that surprise people)

* A **text lesson** can be marked done after the learner has really spent 5 seconds on it. A **video lesson** needs 70 % of the video
  watched (a clip of a few seconds needs only a second or two); the app reports time every 10 seconds and the server counts only genuine, continuous
  watching, so skipping to the end does not complete it. Watching at 2x speed may therefore fall short of 70 %.
* A **quiz** unlocks when the module's lessons are done. The pass mark is set per quiz (70 % unless the admin changes it); a learner can try a quiz 10 times in 24 hours.
* A **certificate** is issued automatically when every required lesson is done and every quiz is passed. It carries a number and a QR code that opens
  `/verify/<number>`; an admin can revoke or reinstate it.
* **Accounts:** learners register themselves (open, with a code from the trainer, or closed; `REGISTRATION_MODE`). Trainers can see
  learners and progress; admins also manage courses, learners, staff, certificates and send broadcasts. Every admin action is written to the audit log.
* **Privacy controls built in:** consent and age confirmation at registration, data export and account deletion from the profile screen,
  and an admin "erase learner" action. See [docs/DPDP-CHECKLIST.md](docs/DPDP-CHECKLIST.md) for what still needs your legal review.

## Repository map

```
client/src/        mobile app: screens/, components/, hooks/, lib/ (api client, offline cache, learning rules), i18n/ (en, hi)
server/            API: app.ts (middleware and routes), routes/, services/, auth/, middleware/, health.ts, configLoader.ts
shared/            code used by app, API and console: schema.ts (database), validation.ts, errors.ts, markdown.ts
admin/src/         admin console (React, built with esbuild into admin/dist)
migrations/        SQL migrations, applied by `npm run db:migrate` and by the Docker entry point
scripts/           build-server, build-admin, seed, create-admin, check-release-config, make-brand-assets, ops/ (backup, restore)
nginx/             reverse-proxy configuration for a Linux host
docs/              runbook, security notes, DPDP checklist, mobile release guide, remediation report
.github/           CI (ci.yml), release (deploy.yml), dependabot
Dockerfile, docker-compose.yml, docker-entrypoint.sh, eas.json, app.json
```

## Where to go next

| I want to... | Read |
|--------------|------|
| put it on a server | [DEPLOYMENT.md](DEPLOYMENT.md) |
| run it, back it up, handle an incident | [docs/RUNBOOK.md](docs/RUNBOOK.md) |
| know how it is secured | [docs/SECURITY.md](docs/SECURITY.md) |
| check privacy and legal readiness | [docs/DPDP-CHECKLIST.md](docs/DPDP-CHECKLIST.md) |
| build and publish the app | [docs/MOBILE-RELEASE.md](docs/MOBILE-RELEASE.md) |
| see what changed and what is still open | [CHANGELOG.md](CHANGELOG.md), [docs/REMEDIATION.md](docs/REMEDIATION.md) |
