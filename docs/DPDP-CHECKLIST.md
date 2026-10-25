# Privacy and DPDP checklist

What the software does with people's data, what it already gives you for India's Digital Personal Data Protection (DPDP) Act, and what **you** still have to write, decide and sign.

> **This is an engineering checklist, not legal advice.** The dates and duties below are how I read public summaries of the Act and the DPDP Rules, 2025
> (sources at the end). Have a lawyer who knows Indian data-protection law review the notice, the retention periods and the contracts before launch.

## 1. Where the law stands (as understood in October 2026)

| Date | What starts |
|------|-------------|
| 13 Nov 2025 | The DPDP Rules, 2025 were notified (G.S.R. 846(E)). The rules that set up the Data Protection Board and the definitions (Rules 1, 2, 17 to 21) apply from this day |
| 13 Nov 2026 | Consent managers (Rule 4). Not relevant to this app |
| 13 May 2027 | The duties that bind a business like yours: the notice you give people (Rule 3), security safeguards, breach reporting, retention and erasure, a published contact for questions, children's data, people's rights (Rules 3 and 5 to 16, 22, 23) |

The government has said it intends to shorten the 18-month window; a legal tracker reviewed on 20 September 2026 found no amending notice, but confirm the date with counsel before you plan around 13 May 2027.

So there are about six months to get the notice, the retention rules, the contracts and the incident process in place. The penalties in the Act's schedule are large (up to ₹250 crore for failing to keep reasonable security safeguards, as I read it); confirm the current figures with counsel.

## 2. What the system holds about people

| Data | Where | Why | Who can see it | What happens to it |
|------|-------|-----|----------------|--------------------|
| Username, display name, language | `users` | Sign in, name on the certificate | The person; admins and trainers | Erased: name becomes "Deleted user", username becomes `deleted_…` |
| Phone number and e-mail (both optional) | `users` | Contact; password reset by e-mail | The person; admins and trainers (learner page, CSV export) | Erased |
| Password | `users.password_hash` (scrypt, not readable) | Sign in | Nobody | Replaced by an unusable value |
| Which notice they accepted, and when | `users.consent_version`, `consent_accepted_at` | Proof of consent | The person (export); admins (learner page) | Erased. The "I am 18 or older" tick is required but **not stored** |
| Sign-in sessions | `refresh_tokens`: hash of the token, browser/phone description, times (no IP address) | Stay signed in | Operators with database access | Deleted when they expire (30 days unused, 90 days at most) and on erase |
| Push address | `push_devices`: Expo token, platform, last seen | Notifications | Operators; sent to Expo | Removed at sign-out and on erase |
| Learning records | `course_enrollments`, `lesson_progress` (position, seconds watched), `module_progress`, `quiz_attempts` (answers and score) | Progress, certificate decisions | The person; admins and trainers | Erased |
| Certificates | `certificates`: number, name and course as on the day of issue, dates, revocation | Proof of training | The person; admins. **Anyone with the number** sees name, course and date on `/verify/<number>` | Erased: the number then stops verifying (the delete screen says so) |
| Admin audit log | `audit_logs`: who did what, to which record id, IP address, request id, small details | Accountability | Admins | Kept. Entries made *by* an erased person lose their username; entries about them hold only an opaque id |
| Request logs | API container log and nginx: time, path, status, user id, IP address, request id. Never query strings, passwords or tokens | Operations and security | Operators | Your log policy (section 5) |
| Backups | Copies of everything above | Recovery | Operators | Deleted after `BACKUP_KEEP_DAYS`. **A restore brings erased people back**: see section 6 |

Not collected: location, contacts, photos, advertising identifiers, analytics. The app has no analytics or advertising SDK.

## 3. Who else touches the data

The organisation that runs the training is the **Data Fiduciary**. Every service below acts for you (a **Data Processor**), and the Act expects a written contract with each.

| Service | What it receives | Needed? |
|---------|------------------|---------|
| Server host and managed database (for example AWS, DigitalOcean, Neon, Render) | Everything | Always |
| E-mail (SMTP) provider | The learner's e-mail address and the reset code | Only if password reset by e-mail is on |
| Expo push service, then Apple and Google | Push token, notification text | Only if learners allow notifications |
| YouTube (Google) | The learner's device talks to Google while a YouTube lesson plays | Only for YouTube lessons. Say so in the notice |
| S3 / Cloudinary | Course videos and images (no learner data) | Only for uploaded media |
| Backup storage | Encrypted database copies | Always |
| Error or log service you add | Whatever you send it | Optional |

Check where each one stores data. Sending personal data outside India is allowed unless the government restricts a country, but your counsel should confirm the position for the places you choose.

## 4. What the software already gives you

| Duty or right | What exists | What is still yours |
|---------------|-------------|---------------------|
| Notice and consent at sign-up | Registration needs the Terms and Privacy Policy tick and an adult tick; the notice links come from `PRIVACY_POLICY_URL` and `TERMS_URL`; the accepted version and time are stored | Write the notice (outline in section 8), host it in English and Hindi, set both URLs |
| Notice to people who already have accounts | **Not built.** Accounts created before this version have no consent record, and raising `CONSENT_VERSION` does not ask anyone again | Until it is built: publish the notice, send a **Broadcast** that points to it (admin console), have trainers brief crews, keep the dates. Ask your developer for an in-app "accept the updated notice" screen; it works like the forced password-change screen (a flag on `/auth/me`, one screen, one endpoint) |
| Access to one's data | Profile → "Download my data" (JSON of profile, progress, quiz attempts, certificates) | Answer people who ask in another way (a phone call to the trainer) |
| Correction | Profile → Edit: name, phone, e-mail, language | Decide how a wrong name on an issued certificate is corrected (revoke and reissue) |
| Erasure | Profile → "Delete my account" (password required); admins: learner page → "Erase this learner's data" | A written process for requests that arrive by phone or e-mail, and for backups (section 6) |
| Withdraw consent | Same as erasure | Say so in the notice |
| Grievance contact | `SUPPORT_EMAIL` and `SUPPORT_PHONE` are shown in the app | Name a person, publish how to reach them and how fast they answer (the Rules, as I read them, allow up to 90 days to reply: promise much less) |
| Security safeguards | [SECURITY.md](SECURITY.md) | Penetration test, a documented review, the off-server encrypted backups |
| Breach handling | Audit log, request ids, [RUNBOOK.md](RUNBOOK.md) incident steps | Section 7 below, agreed in advance |
| Children | Registration only for people who tick "I am 18 or older" | Section 5 |

## 5. Decisions only you and your counsel can make

1. **Consent or "employment" as the basis.** If the employer or contractor requires the training, the Act's legitimate-use ground for employment may fit better than consent. It changes what the notice says and what people can withdraw. Ask.
2. **Under-18s.** The Act treats everyone under 18 as a child and requires verifiable parental consent. The app only asks adults to tick a box, which is a self-declaration and is not stored. If apprentices or trainees under 18 can join, you need a different process; if not, have trainers check age at enrolment and tell your counsel that you rely on that.
3. **Retention.** Nothing deletes learners automatically. Proposal to discuss:
   * Active learners: keep while they use the training.
   * Idle accounts: export the learner list (it has "Last login"), review accounts idle for more than a period you choose (for example 24 months), notify them, then erase them from the console.
   * Certificates: they must stay verifiable for as long as an employer might ask; erasing a person removes theirs.
   * Audit log: keep at least as long as the logs below.
   * Backups: `BACKUP_KEEP_DAYS` (30 in [DEPLOYMENT.md](../DEPLOYMENT.md)), then gone.
4. **Logs.** CERT-In directions ask for system logs for 180 days kept in India. The DPDP Rules (Rule 8(3), from May 2027, as I read them) ask a fiduciary to keep personal data, traffic data and processing logs for at least one year for the purposes in the Seventh Schedule. The API and nginx logs hold IP addresses and user ids. Choose a period (probably the longer one), a place in India, and who may read them.
5. **Who answers questions and complaints.** The Rules ask for published contact details of a person who can answer questions about processing. Choose one, put it in the notice, set `SUPPORT_EMAIL`.
6. **Contracts** with each service in section 3, and where their servers are.
7. **Staff accounts.** Trainers' and admins' own data (name, username, e-mail, what they did) is covered by their engagement terms, not by the learner consent screen. Confirm that with counsel.

## 6. Handling a deletion request

1. Confirm who is asking (the trainer knows the person; for a remote request, ask them to send it from the registered e-mail or phone).
2. Admin console → Learners → the person → **Erase this learner's data** (you type the username to confirm). Record the date and who did it in your own request log, **outside** the database.
3. Tell the person it is done, and that old backups are deleted on schedule (`BACKUP_KEEP_DAYS`).
4. **After any database restore**, go through your request log and erase everyone who was erased after the backup was made. The audit log lives in the same database, so it cannot remind you.

## 7. If personal data is exposed

Treat a lost laptop with a backup, a leaked `.env`, a public bucket, a stolen admin password or a database dump on the internet as a breach until proven otherwise. As I read the rules:

| Within | Who | What |
|--------|-----|------|
| 6 hours of noticing | CERT-In (cert-in.org.in) | Report for the incident types its 2022 directions list; counsel confirms whether yours qualifies |
| Without delay | Every affected person | What happened, what data, what to do, who to contact |
| 72 hours | The Data Protection Board | A detailed report (the first alert is "without delay") |

Steps: [RUNBOOK.md](RUNBOOK.md) section 6 (rotate `JWT_SECRET`, sign everyone out, reset staff passwords, preserve the logs). Write down the time you noticed it. Decide **now** who calls whom.

## 8. What the privacy notice must say

Short, in plain English and Hindi (any language of the Eighth Schedule is allowed), reachable from the registration screen and the profile screen:

* Who you are and how to reach the person who answers questions.
* Exactly what is collected (section 2) and why: to give training, track progress, issue and verify certificates, keep the service secure, and send training messages.
* Who can see it: the learner, trainers and administrators; anyone who has a certificate number sees name, course and date.
* Who else receives it (section 3), including YouTube and the push services.
* How long you keep it, and the rule for idle accounts.
* How to download, correct or delete data, and withdraw consent: Profile screen, or the contact above.
* How to complain, including to the Data Protection Board once it is working.
* That the app is for people aged 18 and over.
* Date and version. Increase `CONSENT_VERSION` when the notice changes materially.

## 9. Before launch

- [ ] Counsel has read this page and the notice.
- [ ] Notice and terms are published; `PRIVACY_POLICY_URL`, `TERMS_URL`, `SUPPORT_EMAIL`, `SUPPORT_PHONE` are set and open from the app.
- [ ] Contracts with the host, database, e-mail and push providers (and S3/Cloudinary if used).
- [ ] Retention periods and log retention decided and written down; log copies go where you decided.
- [ ] Someone is named for questions and complaints, and for incidents; the breach call list exists.
- [ ] Deletion-request log exists outside the database ([RUNBOOK.md](RUNBOOK.md)).
- [ ] Backups are encrypted (`BACKUP_PASSPHRASE_FILE`), stored off the server, and a restore drill has been done.
- [ ] The decision on learners under 18 and on consent versus employment is recorded.
- [ ] You know that existing accounts have no consent record, and have chosen how to inform them (section 4).

## Sources

* Digital Personal Data Protection Act, 2023, and the Digital Personal Data Protection Rules, 2025 (G.S.R. 846(E), 13 November 2025): the text on MeitY's and the Gazette's sites is the authority.
* Summary of the Rules and the phased dates used above: <https://ssrana.in/articles/meity-notifies-final-digital-personal-data-protection-rules-2025/>
* CERT-In Directions of 28 April 2022 (six-hour reporting, 180-day logs).
