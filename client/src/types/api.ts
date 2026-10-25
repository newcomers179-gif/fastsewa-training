/**
 * Shapes of what the API sends, as the server builds them (server/routes/*.ts). Dates arrive as ISO strings.
 * Keep these in step with the routes; server/tests/client-contract.test.ts checks real server answers against them.
 * (No React Native imports here, so the server's tests can use these types too.)
 */
import type { Category, ContentType, Difficulty, Lang, Role } from "@shared/constants";

export type { Category, ContentType, Difficulty, Lang, Role };

// ─── Auth ─────────────────────────────────────────────────────────────────────
export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  preferredLang: Lang;
  avatarUrl: string | null;
  email: string | null;
  phoneNumber: string | null;
  /** True after an administrator issued a one-time password: nothing else works until a new one is chosen. */
  mustChangePassword: boolean;
  createdAt: string;
}

export interface AuthResult {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/** GET /config — public, lets the app adapt without a new release. */
export interface AppConfig {
  apiVersion: number;
  registrationMode: "open" | "code" | "closed";
  registrationCodeRequired: boolean;
  passwordResetByEmail: boolean;
  consentVersion: string;
  privacyPolicyUrl: string | null;
  termsUrl: string | null;
  supportEmail: string | null;
  supportPhone: string | null;
  serverTime: string;
}

// ─── Courses ──────────────────────────────────────────────────────────────────
interface CourseBase {
  id: string;
  slug: string;
  title: string;
  titleHi: string | null;
  description: string;
  descriptionHi: string | null;
  category: Category;
  difficulty: Difficulty;
  thumbnailUrl: string | null;
  durationMinutes: number;
  isPublished: boolean;
  archivedAt: string | null;
}

/** GET /courses */
export interface CourseListItem extends CourseBase {
  moduleCount: number;
  lessonCount: number;
  enrolled: boolean;
  completionPercent: number;
  completedAt: string | null;
}

export interface LessonOutline {
  id: string;
  moduleId: string;
  title: string;
  titleHi: string | null;
  contentType: ContentType;
  videoDurationSeconds: number | null;
  sortOrder: number;
  isRequired: boolean;
  completed: boolean;
}

export interface ModuleOutline {
  id: string;
  title: string;
  titleHi: string | null;
  description: string | null;
  descriptionHi: string | null;
  sortOrder: number;
  hasQuiz: boolean;
  quizPassed: boolean;
  completed: boolean;
  lessons: LessonOutline[];
}

export interface EnrollmentView {
  id: string;
  enrolledAt: string;
  completedAt: string | null;
  completionPercent: number;
}

/** GET /courses/:id — outline only; lesson text and media URLs come from the lesson endpoint. */
export interface CourseOutline extends CourseBase {
  /** Staff looking at a course they are not enrolled in. */
  preview: boolean;
  enrollment: EnrollmentView | null;
  modules: ModuleOutline[];
}

export interface QuizStatus {
  locked: boolean;
  passed: boolean;
  bestScore: number | null;
  attemptsToday: number;
  maxAttempts: number;
  /** Set when today's allowance is used up: when the next attempt is allowed. */
  nextAttemptAt: string | null;
}

/** GET /courses/module/:id */
export interface ModuleDetail {
  id: string;
  courseId: string;
  title: string;
  titleHi: string | null;
  description: string | null;
  descriptionHi: string | null;
  sortOrder: number;
  lessons: LessonOutline[];
  progress: { requiredLessons: number; requiredDone: number; lessonsDone: boolean; completed: boolean } | null;
  quiz: ({ id: string; title: string; passingScore: number } & QuizStatus) | null;
}

export interface LessonProgressView {
  lessonId: string;
  completed: boolean;
  videoProgressSeconds: number;
  /** Time the server itself measured between heartbeats. */
  watchedSeconds: number;
  requiredSeconds: number;
  canComplete: boolean;
  completedAt: string | null;
}

export type VideoProvider = "youtube" | "cloudinary" | "s3" | "local" | "external";

/** GET /courses/lesson/:id */
export interface LessonDetail {
  id: string;
  moduleId: string;
  courseId: string;
  title: string;
  titleHi: string | null;
  contentType: ContentType;
  videoUrl: string | null;
  videoProvider: VideoProvider | null;
  videoDurationSeconds: number | null;
  content: string | null;
  contentHi: string | null;
  imageUrl: string | null;
  sortOrder: number;
  isRequired: boolean;
  progress: LessonProgressView;
}

// ─── Progress ─────────────────────────────────────────────────────────────────
export interface CertificateIssued {
  id: string;
  certificateNumber: string;
  courseId: string;
  earnedAt: string;
}

/** POST /progress/lesson */
export interface RecordResult {
  progress: LessonProgressView;
  course: { percent: number; completed: boolean } | null;
  newCertificate: CertificateIssued | null;
}

export interface TaskLesson {
  id: string;
  moduleId: string;
  title: string;
  titleHi: string | null;
  contentType: ContentType;
  sortOrder: number;
  isRequired: boolean;
  completed: boolean;
}

export interface TaskModule {
  id: string;
  title: string;
  titleHi: string | null;
  sortOrder: number;
  lessons: TaskLesson[];
}

/** GET /progress/enrolled-courses */
export interface EnrolledCourse {
  id: string;
  title: string;
  titleHi: string | null;
  category: Category;
  completionPercent: number;
  completedAt: string | null;
  modules: TaskModule[];
}

/** GET /progress/stats */
export interface Stats {
  modulesCompleted: number;
  lessonsCompleted: number;
  certificatesEarned: number;
  coursesEnrolled: number;
  coursesCompleted: number;
  learningMinutes: number;
}

// ─── Quiz ─────────────────────────────────────────────────────────────────────
export interface QuizQuestion {
  id: string;
  question: string;
  questionHi: string | null;
  options: string[];
  optionsHi: string[] | null;
  sortOrder: number;
}

/** GET /quiz/module/:moduleId — never contains the answers. */
export interface QuizData {
  quiz: { id: string; title: string; passingScore: number; moduleId: string };
  questions: QuizQuestion[];
  status: QuizStatus;
}

export interface QuizFeedback {
  questionId: string;
  yourAnswer: number;
  isCorrect: boolean;
  /** Only after the quiz is passed. */
  correctAnswer?: number;
  explanation?: string | null;
  explanationHi?: string | null;
}

/** POST /quiz/:id/submit */
export interface QuizResult {
  score: number;
  passed: boolean;
  passingScore: number;
  correctCount: number;
  totalQuestions: number;
  feedback: QuizFeedback[];
  attemptsToday: number;
  attemptsRemaining: number;
  course: { percent: number; completed: boolean } | null;
  newCertificate: CertificateIssued | null;
}

// ─── Certificates ─────────────────────────────────────────────────────────────
/** GET /certificates */
export interface CertificateItem {
  id: string;
  certificateNumber: string;
  earnedAt: string;
  revoked: boolean;
  courseId: string;
  courseTitle: string;
  courseTitleHi: string | null;
  courseCategory: Category;
}

/** GET /certificates/:id/download-link */
export interface DownloadLink {
  url: string;
  expiresAt: string;
}
