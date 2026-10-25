-- Rows as the ORIGINAL release (migrations 0000 + 0001) would have let them in. They break every rule the
-- later migrations add — case-variant duplicate usernames and e-mails, blank e-mail, two quizzes in one module,
-- two certificates for one user and course, out-of-range numbers, duplicate refresh-token hashes — so
-- migrations.test.ts can prove that the upgrade repairs them instead of failing on the new constraints.
insert into users (id, username, email, password_hash, display_name, role, created_at, expo_push_token) values
 ('11111111-0000-0000-0000-000000000001','Ramesh','Ramesh@Example.com','$2b$12$aaaaaaaaaaaaaaaaaaaaaa','Ramesh','worker','2026-01-01 10:00:00','ExponentPushToken[abc]'),
 ('11111111-0000-0000-0000-000000000002','ramesh','ramesh@example.com','$2b$12$bbbbbbbbbbbbbbbbbbbbbb','Ramesh Two','worker','2026-01-02 10:00:00',NULL),
 ('11111111-0000-0000-0000-000000000003','RAMESH','  ','$2b$12$cccccccccccccccccccccc','Ramesh Three','worker','2026-01-03 10:00:00',NULL),
 ('11111111-0000-0000-0000-000000000004','priya',NULL,'$2b$12$dddddddddddddddddddddd','Priya','worker','2026-01-01 10:00:00',NULL),
 ('11111111-0000-0000-0000-0000000000a1','admin','admin@x.com','$2b$12$eeeeeeeeeeeeeeeeeeeeee','Admin','admin','2025-12-01 10:00:00',NULL);
insert into courses (id, slug, title, description, category) values
 ('c0000000-0000-0000-0000-000000000001','safety','Safety','Safety course description','safety');
insert into modules (id, course_id, title) values
 ('d0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001','M1');
insert into quizzes (id, module_id, title, passing_score, created_at) values
 ('e0000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','Quiz A', 70, '2026-01-01 10:00:00'),
 ('e0000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000001','Quiz B', 150, '2026-01-01 11:00:00');
insert into quiz_attempts (user_id, quiz_id, answers, score, passed) values
 ('11111111-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000002','[0,1]', 50, false),
 ('11111111-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001','[1,1]', 100, true);
insert into certificates (id, user_id, course_id, certificate_number, earned_at) values
 ('f0000000-0000-0000-0000-000000000001','11111111-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001','FSWA-OLD-1','2026-02-01 10:00:00'),
 ('f0000000-0000-0000-0000-000000000002','11111111-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001','FSWA-OLD-2','2026-02-02 10:00:00'),
 ('f0000000-0000-0000-0000-000000000003','11111111-0000-0000-0000-000000000004','c0000000-0000-0000-0000-000000000001','FSWA-OLD-3','2026-02-03 10:00:00');
insert into course_enrollments (user_id, course_id, completion_percent) values
 ('11111111-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001', 120);
insert into refresh_tokens (user_id, token_hash, expires_at) values
 ('11111111-0000-0000-0000-000000000001','dup-hash','2027-01-01 00:00:00'),
 ('11111111-0000-0000-0000-000000000001','dup-hash','2027-01-01 00:00:00'),
 ('11111111-0000-0000-0000-000000000004','unique-hash','2027-01-01 00:00:00');
