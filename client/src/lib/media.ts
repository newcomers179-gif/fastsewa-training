/**
 * Lesson media addresses as the app may load them. The server accepts http(s) links and, for
 * locally stored uploads, a relative "/uploads/…" path; anything else (javascript:, file:, data:)
 * is never handed to an image or video component.
 */
export function resolveMediaUrl(url: string | null | undefined, apiBase: string): string | null {
  const value = (url ?? "").trim();
  if (value === "") return null;
  if (/^https?:\/\/[^\s]+$/i.test(value)) return value;
  if (value.startsWith("/") && !value.startsWith("//")) return `${apiBase.replace(/\/+$/, "")}${value}`;
  return null;
}
