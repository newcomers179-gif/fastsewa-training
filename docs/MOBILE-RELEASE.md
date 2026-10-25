# Building and publishing the mobile app

The app is an Expo (SDK 54) project built in the cloud with EAS. This page is the route from this repository to a build on a phone and then to the stores.
Nothing here could be run from the environment this repository was prepared in (no Expo account, no store accounts, no real phone), so the steps are from Expo's
documentation and the checks in `scripts/check-release-config.mjs`; expect to adjust them to what the tools print.

## 1. Once, before the first build

| Step | How | Why |
|------|-----|-----|
| Accounts | An [Expo](https://expo.dev) account; a Google Play Console account; an Apple Developer Program account (only for iPhone) | Builds, signing and store uploads |
| Install and sign in | `npm install -g eas-cli`, then `eas login` | |
| Link the project | `eas init`, commit the `extra.eas.projectId` it writes to `app.json` | Push notifications need it; `npm run check:release` refuses a placeholder |
| Real API address | Edit `eas.json`: `build.production.env.EXPO_PUBLIC_API_URL` (and `preview`, for a staging server) to the https address of the deployed API | Store builds cannot reach `localhost`, and the check refuses `http://` and `example` addresses |
| App identity | `app.json` uses `com.fastsewa.training` for iOS and Android. Change it **now** if your organisation uses another reverse-domain name: it cannot change after the first store upload | |
| Version numbers | `eas build:version:set -p android` once (and `-p ios`) to give EAS its starting build number; `appVersionSource` is `remote` and production builds auto-increment | |
| Check | `npm run check:release` | Prints every placeholder or mismatch; it also runs at the start of every EAS build |
| Brand | `client/assets/images/*` are generated from the admin console's mark so that the build works. Replace them with your logo (1024×1024 `icon.png`, `adaptive-icon.png` with a safe zone, `splash-icon.png`, `notification-icon.png` white on transparent) or edit and rerun `node scripts/make-brand-assets.mjs` | |

## 2. Push notifications (optional but wanted)

* **Android:** create a Firebase project, add an Android app with the package name above, put its `google-services.json` in the repository root and set `android.googleServicesFile` to `./google-services.json` in `app.json` (that file names your Firebase app and is not a password), then upload the FCM V1 **service-account key** with `eas credentials` (that one is a secret: never commit it).
* **iOS:** `eas build` offers to create the Apple push key; confirm that the `aps-environment` entitlement in the finished build is `production` (the Expo plugin sets it; I could not check it here).
* The server needs nothing except, if you turned on enhanced push security, `EXPO_ACCESS_TOKEN`.
* The app asks for permission **once**. Without any of this the app works and simply never shows a notification.

## 3. Build

```bash
eas build --platform android --profile preview       # an .apk you can install directly, pointing at the preview API address
eas build --platform android --profile production    # an .aab for Google Play
eas build --platform ios --profile production        # for TestFlight and the App Store
```

* `development` builds the Expo development client for developers; it finds the API on the developer's computer by itself.
* Keep the Android signing key in EAS (let it generate one) and enable Play App Signing; download a backup with `eas credentials`.
* After changing `EXPO_PUBLIC_API_URL`, build again: the address is compiled into the app.
* No over-the-air updates are configured (`updates` and `runtimeVersion` are empty in `app.json`): every change ships as a store release. Turning on `expo-updates` is a separate decision.

## 4. Test on real phones before you submit

Automated checks cover the logic and the web build of every screen; they cannot cover hardware. Test the **production-profile** build on at least one low-end Android phone with Android 10 or 11, one recent Android, and, if you publish for iOS, an iPhone:

- [ ] Register with a code, sign out, sign in, kill the app and reopen it (still signed in).
- [ ] Switch language English ↔ Hindi; text is not cut off at the largest system font size.
- [ ] Airplane mode: courses already opened are still shown; a lesson finished offline does not claim to be saved.
- [ ] A **YouTube lesson** plays inside the app and counts watch time; a video that YouTube refuses to embed shows the "tell your trainer" message, not a blank page. (If YouTube reports error 153, the embed needs the app's referrer to be allowed; try an unlisted video you own.)
- [ ] A hosted video (S3/Cloudinary) plays, can be paused and resumed, and resumes where it stopped.
- [ ] Watch a 70 % video at normal speed: the lesson completes. At 2x speed it may not (by design: only genuine, continuous watching counts).
- [ ] Quiz: pass, fail, hit the attempt limit; the certificate arrives; **Share** and **Download PDF** work; the QR code opens `/verify/<number>` in the phone's browser.
- [ ] Push: with permission granted, an admin Broadcast arrives within a minute with the app closed; a tap opens the app.
- [ ] Sign in with a one-time password issued by an admin: the app forces a new password.
- [ ] Profile → Download my data; Delete my account (with a throw-away account).
- [ ] Back button and gestures never reveal a signed-in screen after sign-out.
- [ ] Screen reader (TalkBack or VoiceOver) can reach every button on the login, lesson and quiz screens.

A device-testing framework (Maestro or Detox) would let you repeat this list on every release; none is set up.

## 5. Store listings

* **Privacy policy URL:** the same `PRIVACY_POLICY_URL` you configured; both stores require one that opens without signing in ([DPDP-CHECKLIST.md](DPDP-CHECKLIST.md)).
* **Google Play "Data safety":** collected (name, user id, phone number and e-mail if given, in-app activity such as lesson progress and quiz answers, device or other ids for push), encrypted in transit, users can request deletion (Profile → Delete my account), not sold, not shared except with service providers (the push service and, for YouTube lessons, YouTube). No ads, no location, no contacts.
* **Apple "App Privacy":** the same list, "linked to the user", "not used for tracking". `usesNonExemptEncryption` is already `false` (the app uses only standard HTTPS).
* **Account deletion:** both stores require in-app deletion for apps with sign-up; it exists (Profile → Delete my account).
* **Age rating:** the app is for adults ([DPDP-CHECKLIST.md](DPDP-CHECKLIST.md), section 5).
* **Content:** the sample courses are marked "(Sample)". Publish real, reviewed course content before submitting, or the reviewer sees training material nobody has approved.

## 6. Submit

```bash
eas submit --platform android --profile production   # needs the Google service-account key (google-service-account.json, never committed)
eas submit --platform ios --profile production
```

The first upload of a new Android app usually has to be done by hand in Play Console; `eas submit` works from the second one. Start on the **internal** track (what `eas.json` is set to), test the installed store build, then promote.

## 7. Releasing a new version

1. Change the number in `app.json`, `package.json` and `server/package.json` together (`npm run check:release` fails if they differ), update [CHANGELOG.md](../CHANGELOG.md).
2. Deploy the API first when the release needs a new API feature, and keep the API compatible with the app versions still in the stores: people update late. `/config` reports `apiVersion` for the day you need to force a change.
3. `eas build`, test, `eas submit`.
4. Tag the repository `vX.Y.Z`: the release workflow builds and publishes the API image and checks that all version numbers agree.

## 8. Upgrading Expo

Each Expo SDK is supported for a limited time. To upgrade: `npx expo install expo@latest`, then `npx expo install --fix` (it aligns every Expo package), `npx expo-doctor`, `npm run check:types`, `npm test`, a new `eas build` and the checklist in section 4. Do it on a branch; expect to touch `babel.config.js`, `metro.config.js` and the navigation packages.

## 9. Crash reporting

The app reports unexpected errors through `client/src/lib/report.ts`, which only prints in development. To collect real crashes, install a reporter such as Sentry for Expo, call `setErrorReporter(Sentry.captureException)` once at start-up in `client/src/App.tsx`, mention it in the privacy notice and the store data-safety forms, and keep personal data out of what it sends.
