/**
 * Value lists used by the API, the mobile app and the admin console. Dependency-free on purpose
 * (see validation.ts): the database schema builds its enums from these, so the lists cannot drift.
 */
export const ROLES = ["admin", "trainer", "worker"] as const;
export const CATEGORIES = ["safety", "basics", "tools", "discipline", "electrical", "plumbing", "masonry", "equipment"] as const;
export const DIFFICULTIES = ["beginner", "intermediate", "advanced"] as const;
export const CONTENT_TYPES = ["video", "text", "image", "quiz"] as const;
export const LANGS = ["en", "hi"] as const;

export type Role = (typeof ROLES)[number];
export type Category = (typeof CATEGORIES)[number];
export type Difficulty = (typeof DIFFICULTIES)[number];
export type ContentType = (typeof CONTENT_TYPES)[number];
export type Lang = (typeof LANGS)[number];
