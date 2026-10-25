/**
 * Request-body schemas (zod). Field-level rules that have their own error code
 * for the mobile app (password policy, phone, uniqueness, consent) are checked
 * in the route handlers so the client receives a precise `code`.
 */
import { z } from "zod";
import { CATEGORIES, DIFFICULTIES, LANGS } from "@shared/schema";
import { DISPLAY_NAME_MAX, isValidDisplayName, normalizeDisplayName } from "@shared/validation";

const optionalText = (max: number) => z.string().trim().max(max).nullish();
const id = z.string().regex(/^[0-9a-fA-F-]{36}$/, "Invalid id");
const displayName = z
  .string()
  .min(1, "Name is required")
  .max(DISPLAY_NAME_MAX * 2) // before trimming; the real limit is checked on the normalised value
  .transform(normalizeDisplayName)
  .refine(isValidDisplayName, "Use English or Hindi letters only (no digits or symbols)");

// ─── Auth ────────────────────────────────────────────────────────────────────
export const registerBody = z.object({
  username: z.string().max(60),
  password: z.string().max(512),
  displayName,
  email: z.string().trim().max(254).nullish(),
  phoneNumber: z.string().trim().max(40).nullish(),
  preferredLang: z.enum(LANGS).optional(),
  registrationCode: z.string().trim().max(100).optional(),
  acceptTerms: z.boolean().optional(),
  confirmAdult: z.boolean().optional(),
});

export const loginBody = z.object({
  username: z.string().min(1).max(60),
  password: z.string().min(1).max(512),
});

export const refreshBody = z.object({ refreshToken: z.string().min(16).max(1024) });
export const logoutBody = z.object({ refreshToken: z.string().max(1024).optional() });

export const forgotPasswordBody = z.object({ email: z.string().trim().min(3).max(254) });
export const resetPasswordBody = z.object({
  email: z.string().trim().min(3).max(254),
  code: z.string().trim().min(6).max(12),
  newPassword: z.string().max(512),
});
export const changePasswordBody = z.object({
  currentPassword: z.string().min(1).max(512),
  newPassword: z.string().max(512),
});
export const deleteAccountBody = z.object({ password: z.string().min(1).max(512) });

export const updateProfileBody = z
  .object({
    displayName: displayName.optional(),
    preferredLang: z.enum(LANGS).optional(),
    phoneNumber: z.string().trim().max(40).nullish(),
    email: z.string().trim().max(254).nullish(),
  })
  .strict();

export const pushTokenBody = z.object({
  token: z.string().trim().regex(/^Expo(nent)?PushToken\[[A-Za-z0-9_-]{8,}\]$/, "Not an Expo push token"),
  platform: z.enum(["ios", "android", "web"]).optional(),
});

// ─── Learning ────────────────────────────────────────────────────────────────
export const lessonProgressBody = z.object({
  lessonId: id,
  /** Resume position in seconds (for videos). */
  videoProgressSeconds: z.number().int().min(0).max(86_400).optional(),
  positionSeconds: z.number().int().min(0).max(86_400).optional(),
  completed: z.boolean().optional(),
});

export const quizSubmitBody = z.object({
  answers: z.array(z.number().int().min(0).max(20)).min(1).max(200),
});

export const courseListQuery = z.object({
  category: z.enum(CATEGORIES).optional(),
  q: z.string().trim().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});

// ─── Admin: content ──────────────────────────────────────────────────────────
export const courseInput = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(2)
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Lowercase letters, numbers and single hyphens only"),
  title: z.string().trim().min(2).max(160),
  titleHi: optionalText(160),
  description: z.string().trim().min(10).max(4000),
  descriptionHi: optionalText(4000),
  category: z.enum(CATEGORIES),
  difficulty: z.enum(DIFFICULTIES),
  thumbnailUrl: optionalText(2048),
  durationMinutes: z.number().int().min(0).max(100_000).optional(),
  sortOrder: z.number().int().min(0).max(100_000).optional(),
});
export const courseCreateBody = courseInput;
export const courseUpdateBody = courseInput.partial();

export const moduleInput = z.object({
  title: z.string().trim().min(2).max(160),
  titleHi: optionalText(160),
  description: optionalText(2000),
  descriptionHi: optionalText(2000),
  sortOrder: z.number().int().min(0).max(100_000).optional(),
});
export const moduleCreateBody = moduleInput;
export const moduleUpdateBody = moduleInput.partial();

export const lessonInput = z.object({
  title: z.string().trim().min(2).max(160),
  titleHi: optionalText(160),
  contentType: z.enum(["video", "text", "image", "quiz"]),
  videoUrl: optionalText(2048),
  videoDurationSeconds: z.number().int().min(1).max(86_400).nullish(),
  content: z.string().max(100_000).nullish(),
  contentHi: z.string().max(100_000).nullish(),
  imageUrl: optionalText(2048),
  sortOrder: z.number().int().min(0).max(100_000).optional(),
  isRequired: z.boolean().optional(),
});
export const lessonCreateBody = lessonInput;
export const lessonUpdateBody = lessonInput.partial();

export const publishBody = z.object({ published: z.boolean() });

export const reorderBody = z.object({ ids: z.array(id).min(1).max(500) });

const questionInput = z
  .object({
    question: z.string().trim().min(3).max(1000),
    questionHi: optionalText(1000),
    options: z.array(z.string().trim().min(1).max(500)).min(2).max(6),
    optionsHi: z.array(z.string().trim().min(1).max(500)).min(2).max(6).nullish(),
    correctIndex: z.number().int().min(0).max(5),
    explanation: optionalText(2000),
    explanationHi: optionalText(2000),
  })
  .superRefine((q, ctx) => {
    if (q.correctIndex >= q.options.length) {
      ctx.addIssue({ code: "custom", path: ["correctIndex"], message: "Correct answer must be one of the options" });
    }
    if (q.optionsHi && q.optionsHi.length !== q.options.length) {
      ctx.addIssue({ code: "custom", path: ["optionsHi"], message: "Hindi options must match the number of English options" });
    }
  });

export const quizInput = z.object({
  title: z.string().trim().min(2).max(160),
  passingScore: z.number().int().min(1).max(100).default(70),
  questions: z.array(questionInput).min(1).max(100),
});

// ─── Admin: people ───────────────────────────────────────────────────────────
export const workerListQuery = z.object({
  q: z.string().trim().max(80).optional(),
  status: z.enum(["all", "active", "inactive"]).default("all"),
  sort: z.enum(["created", "name", "lastLogin"]).default("created"),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const workerUpdateBody = z
  .object({
    displayName: displayName.optional(),
    phoneNumber: z.string().trim().max(40).nullish(),
    email: z.string().trim().max(254).nullish(),
    preferredLang: z.enum(LANGS).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export const confirmUsernameBody = z.object({ confirmUsername: z.string().max(60) });
export const workerExportQuery = workerListQuery.pick({ q: true, status: true });

export const staffCreateBody = z.object({
  username: z.string().max(60),
  displayName,
  role: z.enum(["admin", "trainer"]),
  email: z.string().trim().max(254).nullish(),
});
export const staffUpdateBody = z
  .object({
    displayName: displayName.optional(),
    role: z.enum(["admin", "trainer"]).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export const broadcastBody = z.object({
  title: z.string().trim().min(1).max(65),
  body: z.string().trim().min(1).max(240),
});

export const revokeBody = z.object({ reason: z.string().trim().min(3).max(300) });
export const certificateLookupQuery = z.object({ number: z.string().trim().min(4).max(60) });

export const auditQuery = z.object({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  action: z.string().trim().max(60).optional(),
});

export const analyticsQuery = z.object({
  days: z.coerce.number().int().min(7).max(180).default(30),
});

// ─── Admin: media ────────────────────────────────────────────────────────────
export const mediaSignBody = z.object({
  kind: z.enum(["image", "video"]),
  filename: z.string().trim().min(1).max(200),
  contentType: z.string().trim().min(3).max(100),
  bytes: z.number().int().min(1).max(5 * 1024 * 1024 * 1024),
  folder: z.enum(["thumbnails", "images", "videos"]).optional(),
});
export const mediaCompleteBody = z.object({
  uploadId: id,
  /** Cloudinary returns the delivery URL to the browser; S3/R2 and local derive it server-side. */
  url: z.string().trim().max(2048).optional(),
});
