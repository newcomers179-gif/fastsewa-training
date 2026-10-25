/** Dates and durations as the learner reads them (India time, English or Hindi digits-and-words). */
import type { Lang } from "@shared/constants";

const TZ = "Asia/Kolkata";
const locale = (lang: Lang) => (lang === "hi" ? "hi-IN" : "en-IN");

export function formatDate(iso: string | null | undefined, lang: Lang): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return date.toLocaleDateString(locale(lang), { day: "numeric", month: "short", year: "numeric", timeZone: TZ });
  } catch {
    return date.toDateString(); // an engine without Intl time-zone support
  }
}

export function formatMonthYear(iso: string | null | undefined, lang: Lang): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return date.toLocaleDateString(locale(lang), { month: "short", year: "numeric", timeZone: TZ });
  } catch {
    return String(date.getFullYear());
  }
}

export function formatTime(iso: string | null | undefined, lang: Lang): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return date.toLocaleTimeString(locale(lang), { hour: "numeric", minute: "2-digit", timeZone: TZ });
  } catch {
    return date.toTimeString().slice(0, 5);
  }
}

/** 754 → "12:34", 3725 → "1:02:05". */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** Whole minutes, at least 1 for anything longer than nothing. */
export function minutesOf(seconds: number): number {
  return seconds > 0 ? Math.max(1, Math.round(seconds / 60)) : 0;
}

/** "Priya Sharma" → "Priya"; falls back to the whole string. */
export function firstName(displayName: string | null | undefined): string {
  const name = (displayName ?? "").trim();
  return name.split(/\s+/)[0] ?? name;
}

export function initialOf(displayName: string | null | undefined): string {
  const first = Array.from((displayName ?? "").trim())[0];
  return first ? first.toUpperCase() : "?";
}

/** The title/description to show: the Hindi text when the learner reads Hindi and it exists, else English. */
export function pick(lang: Lang, en: string | null | undefined, hi: string | null | undefined): string {
  return lang === "hi" && hi && hi.trim() !== "" ? hi : (en ?? "");
}
