/** Shapes returned by the API (see server/services/*). Dates arrive as ISO strings. */
import type { Category, ContentType, Difficulty, Lang, Role } from "@shared/constants";

export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  preferredLang: Lang;
  avatarUrl: string | null;
  email: string | null;
  phoneNumber: string | null;
  mustChangePassword: boolean;
  createdAt: string;
}

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}
export interface AuthResult extends Tokens {
  user: PublicUser;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

// ─── insights ────────────────────────────────────────────────────────────────
export interface Dashboard {
  totalWorkers: number;
  activeWorkers: number;
  newWorkers7d: number;
  activeLearners7d: number;
  totalCourses: number;
  draftCourses: number;
  totalEnrollments: number;
  completedEnrollments: number;
  completionRate: number;
  certificatesIssued: number;
}
export interface CourseAnalyticsRow {
  courseId: string;
  courseTitle: string;
  isPublished: boolean;
  isArchived: boolean;
  enrolled: number;
  completed: number;
  averagePercent: number;
  certificates: number;
  completionRate: number;
}
export interface ActivityPoint {
  day: string;
  signups: number;
  enrolments: number;
  certificates: number;
}
export interface AuditEntry {
  id: string;
  actorId: string | null;
  actorUsername: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown> | null;
  ip: string | null;
  requestId: string | null;
  createdAt: string;
}

// ─── people ──────────────────────────────────────────────────────────────────
export interface WorkerRow {
  id: string;
  username: string;
  displayName: string;
  phoneNumber: string | null;
  email: string | null;
  preferredLang: Lang;
  isActive: boolean;
  mustChangePassword: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  coursesEnrolled: number;
  coursesCompleted: number;
  certificates: number;
}
export interface WorkerDetail {
  user: {
    id: string;
    username: string;
    displayName: string;
    phoneNumber: string | null;
    email: string | null;
    preferredLang: Lang;
    isActive: boolean;
    mustChangePassword: boolean;
    createdAt: string;
    lastLoginAt: string | null;
    consentVersion: string | null;
    consentAcceptedAt: string | null;
  };
  enrollments: { courseId: string; courseTitle: string; enrolledAt: string; completedAt: string | null; completionPercent: number }[];
  modules: { moduleId: string; moduleTitle: string; courseId: string; startedAt: string; completedAt: string | null; quizScore: number | null; quizPassed: boolean | null }[];
  certificates: { id: string; certificateNumber: string; earnedAt: string; revokedAt: string | null; revokedReason: string | null; courseId: string; courseTitle: string }[];
}
export interface StaffRow {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  role: "admin" | "trainer";
  isActive: boolean;
  mustChangePassword: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}
export interface TemporaryPassword {
  username: string;
  temporaryPassword: string;
}
export interface CertificateInfo {
  id: string;
  certificateNumber: string;
  earnedAt: string;
  revoked: boolean;
  revokedAt: string | null;
  revokedReason: string | null;
  userId: string;
  username: string;
  holderName: string;
  courseId: string;
  courseTitle: string;
}

// ─── content ─────────────────────────────────────────────────────────────────
export type CourseStatus = "draft" | "published" | "archived";

export interface CourseRow {
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
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  status: CourseStatus;
  moduleCount: number;
  lessonCount: number;
  enrolled: number;
  completed: number;
}
export interface LessonSummary {
  id: string;
  moduleId: string;
  title: string;
  titleHi: string | null;
  contentType: ContentType;
  videoUrl: string | null;
  videoProvider: string | null;
  videoDurationSeconds: number | null;
  imageUrl: string | null;
  sortOrder: number;
  isRequired: boolean;
  hasText: boolean;
}
export interface LessonFull extends Omit<LessonSummary, "hasText"> {
  content: string | null;
  contentHi: string | null;
  courseId: string;
}
export interface QuizSummary {
  id: string;
  moduleId: string;
  title: string;
  passingScore: number;
  questionCount: number;
}
export interface ModuleNode {
  id: string;
  courseId: string;
  title: string;
  titleHi: string | null;
  description: string | null;
  descriptionHi: string | null;
  sortOrder: number;
  lessons: LessonSummary[];
  quiz: QuizSummary | null;
}
export interface CourseTree extends Omit<CourseRow, "moduleCount" | "lessonCount" | "enrolled" | "completed"> {
  modules: ModuleNode[];
}
export interface QuizQuestion {
  id?: string;
  question: string;
  questionHi: string | null;
  options: string[];
  optionsHi: string[] | null;
  correctIndex: number;
  explanation: string | null;
  explanationHi: string | null;
}
export interface QuizFull {
  id: string;
  moduleId: string;
  title: string;
  passingScore: number;
  questions: QuizQuestion[];
}

// ─── media ───────────────────────────────────────────────────────────────────
export interface MediaConfig {
  enabled: boolean;
  provider: "none" | "local" | "s3" | "cloudinary";
  maxImageBytes: number;
  maxVideoBytes: number;
  imageTypes: string[];
  videoTypes: string[];
}
export interface UploadTicket {
  uploadId: string;
  provider: "local" | "s3" | "cloudinary";
  method: "PUT" | "POST";
  url: string;
  headers?: Record<string, string>;
  fields?: Record<string, string>;
  fileField?: string;
  expiresAt: string;
  maxBytes: number;
}
export interface BroadcastResult {
  devices: number;
  sent: number;
  failed: number;
  disabled: number;
}
