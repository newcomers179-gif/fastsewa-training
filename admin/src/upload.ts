/**
 * The browser side of media uploads, shared by course thumbnails, lesson images and lesson videos.
 *
 *   1. ask the API for a short-lived upload target (it checks who is asking, the file type and the size);
 *   2. send the bytes there: to this API for the "local" provider, straight to S3/R2 or Cloudinary otherwise,
 *      so large videos never pass through the API server;
 *   3. for S3 and Cloudinary, tell the API the upload finished so it can verify what was stored.
 */
import { api, xhrUpload, type UploadProgress } from "./api";
import { formatBytes } from "./format";
import type { MediaConfig, UploadTicket } from "./types";

export type MediaKind = "image" | "video";

const EXTENSION_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
};

/** Browsers leave `file.type` empty for some formats (.mov on Windows, say), so fall back to the extension. */
export function contentTypeOf(file: File): string {
  if (file.type) return file.type;
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_TYPES[extension] ?? "";
}

const formatName = (mime: string): string => (mime === "video/quicktime" ? "MOV" : (mime.split("/")[1] ?? mime).toUpperCase());

/** Why the file cannot be uploaded, or null when it looks fine. (The server checks the real bytes again.) */
export function checkFile(file: File, kind: MediaKind, config: MediaConfig): string | null {
  const allowed = kind === "image" ? config.imageTypes : config.videoTypes;
  if (!allowed.includes(contentTypeOf(file))) return `Choose a ${kind} in one of these formats: ${allowed.map(formatName).join(", ")}.`;
  if (file.size === 0) return "That file is empty.";
  const max = kind === "image" ? config.maxImageBytes : config.maxVideoBytes;
  if (file.size > max) return `That file is ${formatBytes(file.size)}; the limit for ${kind}s is ${formatBytes(max)}.`;
  return null;
}

export const acceptAttribute = (kind: MediaKind, config: MediaConfig): string => (kind === "image" ? config.imageTypes : config.videoTypes).join(",");
export const describeFormats = (kind: MediaKind, config: MediaConfig): string => (kind === "image" ? config.imageTypes : config.videoTypes).map(formatName).join(", ");

export interface UploadRequest {
  kind: MediaKind;
  file: File;
  folder?: "thumbnails" | "images" | "videos";
  onProgress?: (progress: UploadProgress) => void;
  signal?: AbortSignal;
}

/** Uploads the file and resolves with the URL lessons and courses should store. */
export async function uploadMedia({ kind, file, folder, onProgress, signal }: UploadRequest): Promise<string> {
  const ticket = await api.post<UploadTicket>("/admin/media/sign", {
    kind,
    filename: file.name,
    contentType: contentTypeOf(file),
    bytes: file.size,
    ...(folder ? { folder } : {}),
  });

  if (ticket.provider === "local") {
    const form = new FormData();
    form.append(ticket.fileField ?? "file", file, file.name);
    const text = await xhrUpload({ method: "POST", url: ticket.url, body: form, withAuth: true, onProgress, signal });
    return (JSON.parse(text) as { url: string }).url;
  }

  if (ticket.provider === "s3") {
    await xhrUpload({ method: "PUT", url: ticket.url, headers: ticket.headers, body: file, onProgress, signal });
    const done = await api.post<{ url: string }>("/admin/media/complete", { uploadId: ticket.uploadId });
    return done.url;
  }

  // Cloudinary: signed multipart POST straight to Cloudinary; its answer carries the delivery URL.
  const form = new FormData();
  for (const [name, value] of Object.entries(ticket.fields ?? {})) form.append(name, value);
  form.append(ticket.fileField ?? "file", file, file.name);
  const text = await xhrUpload({ method: "POST", url: ticket.url, body: form, onProgress, signal });
  const delivered = (JSON.parse(text) as { secure_url?: string }).secure_url;
  const done = await api.post<{ url: string }>("/admin/media/complete", { uploadId: ticket.uploadId, url: delivered });
  return done.url;
}

/** Reads a video's length in whole seconds from its metadata, or null when the browser cannot tell. */
export function probeVideoDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    const objectUrl = URL.createObjectURL(file);
    let settled = false;
    const finish = (seconds: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(objectUrl);
      resolve(seconds);
    };
    const timer = setTimeout(() => finish(null), 10_000);
    video.preload = "metadata";
    video.muted = true;
    video.onloadedmetadata = () => finish(Number.isFinite(video.duration) && video.duration > 0 ? Math.max(1, Math.round(video.duration)) : null);
    video.onerror = () => finish(null);
    video.src = objectUrl;
  });
}
