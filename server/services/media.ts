/**
 * Media: which URLs lessons may point at, and how files get uploaded.
 *
 * Why an allow-list: lesson/thumbnail URLs are rendered inside the mobile
 * app's WebView (which runs JavaScript) and in the admin console. Accepting
 * any URL would let a compromised or careless account plant a phishing or
 * script page in front of every worker. Only YouTube and the storage this
 * deployment itself is configured for are accepted.
 *
 * Why direct uploads: videos are up to 500 MB. The API never touches them —
 * it hands the browser a short-lived signed upload target (S3/R2 presigned
 * PUT, Cloudinary signed POST) and later verifies the stored object. (The old
 * endpoint buffered whole videos in the API's memory, so two uploads could
 * exhaust a small server, and tagged objects `public-read`, which modern S3
 * buckets reject.) The `local` provider is for development or a single server
 * with a persistent volume.
 */
import { randomBytes } from "node:crypto";
import { mkdir, open, rename, rm } from "node:fs/promises";
import { extname, join } from "node:path";
import { and, eq, lt } from "drizzle-orm";
import { mediaUploads } from "@shared/schema";
import { parseYouTubeId } from "@shared/validation";
import { config } from "../config";
import { db } from "../db";
import { err, notFound } from "../errors";
import { logger } from "../logger";

export type MediaKind = "image" | "video";
export type VideoProvider = "youtube" | "cloudinary" | "s3" | "local" | "external";

const IMAGE_TYPES: Record<string, string> = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" };
const VIDEO_TYPES: Record<string, string> = { "video/mp4": ".mp4", "video/webm": ".webm", "video/quicktime": ".mov" };

// ─── URL policy ──────────────────────────────────────────────────────────────
const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);

function parseUrl(raw: string): URL | null {
  try {
    const u = new URL(raw);
    if (u.username || u.password) return null;
    return u;
  } catch {
    return null;
  }
}

function protocolOk(u: URL): boolean {
  if (u.protocol === "https:") return true;
  return u.protocol === "http:" && !config.isProd && /^(localhost|127\.0\.0\.1)$/.test(u.hostname);
}

function underBase(u: URL, base: string | null): boolean {
  if (!base) return false;
  const b = parseUrl(base);
  if (!b) return false;
  const prefix = b.pathname.replace(/\/+$/, "");
  return u.origin === b.origin && (u.pathname === prefix || u.pathname.startsWith(`${prefix}/`));
}

function isOwnStorage(u: URL): boolean {
  const { s3, cloudinary, publicBaseUrl, extraAllowedHosts, provider } = config.media;
  if (cloudinary && u.hostname === "res.cloudinary.com" && u.pathname.startsWith(`/${cloudinary.cloudName}/`)) return true;
  if (s3) {
    const hosts = [`${s3.bucket}.s3.${s3.region}.amazonaws.com`, `${s3.bucket}.s3.amazonaws.com`];
    if (hosts.includes(u.hostname)) return true;
    if (s3.endpoint) {
      const e = parseUrl(s3.endpoint);
      if (e && u.origin === e.origin && u.pathname.startsWith(`/${s3.bucket}/`)) return true;
    }
  }
  if (underBase(u, publicBaseUrl)) return true;
  if (extraAllowedHosts.includes(u.hostname)) return true;
  if (provider === "local" && underBase(u, `${config.publicBaseUrl ?? u.origin}/uploads`)) return true;
  return false;
}

/**
 * Returns the normalised URL if lesson/course media may use it, otherwise throws MEDIA_URL_NOT_ALLOWED.
 * `kind: "video"` accepts YouTube links and this deployment's storage; `"image"` only the storage.
 */
export function validateMediaUrl(raw: string, kind: MediaKind): string {
  const value = raw.trim();
  if (value.length > 2048) throw err("MEDIA_URL_NOT_ALLOWED");

  // Relative links to locally stored uploads (development / single-server installs).
  if (value.startsWith("/uploads/") && config.media.provider === "local" && !value.includes("..")) return value;

  const u = parseUrl(value);
  if (!u || !protocolOk(u)) throw err("MEDIA_URL_NOT_ALLOWED");

  if (kind === "video" && YOUTUBE_HOSTS.has(u.hostname)) {
    const id = parseYouTubeId(value);
    if (!id) throw err("MEDIA_URL_NOT_ALLOWED", { message: "That does not look like a YouTube video link" });
    return `https://www.youtube.com/watch?v=${id}`;
  }
  if (isOwnStorage(u)) return u.toString();
  throw err("MEDIA_URL_NOT_ALLOWED");
}

export function videoProviderOf(url: string): VideoProvider {
  if (url.startsWith("/uploads/")) return "local";
  const u = parseUrl(url);
  if (!u) return "external";
  if (YOUTUBE_HOSTS.has(u.hostname)) return "youtube";
  if (u.hostname === "res.cloudinary.com") return "cloudinary";
  if (/\.s3[.-]/.test(u.hostname) || u.hostname.endsWith(".amazonaws.com")) return "s3";
  if (u.pathname.startsWith("/uploads/")) return "local";
  return "external";
}

// ─── Content sniffing ────────────────────────────────────────────────────────
export function sniffContentType(head: Buffer): string | null {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  if (head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (head.length >= 12 && head.toString("ascii", 0, 4) === "RIFF" && head.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (head.length >= 12 && head.toString("ascii", 4, 8) === "ftyp") return head.toString("ascii", 8, 12) === "qt  " ? "video/quicktime" : "video/mp4";
  if (head.length >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return "video/webm";
  return null;
}

/** mp4 and mov share a container family; browsers/phones label them interchangeably. */
function typesCompatible(declared: string, sniffed: string): boolean {
  if (declared === sniffed) return true;
  const family = new Set(["video/mp4", "video/quicktime"]);
  return family.has(declared) && family.has(sniffed);
}

// ─── Upload tickets ──────────────────────────────────────────────────────────
export interface UploadTicket {
  uploadId: string;
  provider: "s3" | "cloudinary" | "local";
  method: "PUT" | "POST";
  url: string;
  headers?: Record<string, string>;
  /** Extra multipart form fields (Cloudinary). The file goes in `fileField`. */
  fields?: Record<string, string>;
  fileField?: string;
  expiresAt: string;
  maxBytes: number;
}

const TICKET_TTL_SECONDS = 15 * 60;

function extensionFor(kind: MediaKind, contentType: string): string {
  return (kind === "image" ? IMAGE_TYPES : VIDEO_TYPES)[contentType] ?? "";
}

export function uploadsAvailable(): boolean {
  return config.media.provider !== "none";
}

/** Origins the admin console's browser talks to directly when uploading (for its Content-Security-Policy). */
export function uploadOrigins(): string[] {
  const { s3, cloudinary } = config.media;
  const origins = new Set<string>();
  if (s3) {
    if (s3.endpoint) {
      const e = parseUrl(s3.endpoint);
      if (e) {
        origins.add(e.origin);
        origins.add(`${e.protocol}//${s3.bucket}.${e.host}`); // virtual-hosted style
      }
    } else {
      origins.add(`https://${s3.bucket}.s3.${s3.region}.amazonaws.com`);
    }
  }
  if (cloudinary) origins.add("https://api.cloudinary.com");
  return [...origins];
}

export async function createUploadTicket(
  actor: { id: string },
  input: { kind: MediaKind; filename: string; contentType: string; bytes: number; folder?: string }
): Promise<UploadTicket> {
  const { provider } = config.media;
  if (provider === "none") throw err("MEDIA_NOT_CONFIGURED");

  const allowed = input.kind === "image" ? IMAGE_TYPES : VIDEO_TYPES;
  const contentType = input.contentType.toLowerCase().split(";")[0].trim();
  if (!allowed[contentType]) throw err("MEDIA_TYPE_NOT_ALLOWED");
  const maxBytes = input.kind === "image" ? config.media.maxImageBytes : config.media.maxVideoBytes;
  if (input.bytes > maxBytes) {
    throw err("MEDIA_TOO_LARGE", { details: { maxBytes } });
  }

  const folder = input.kind === "video" ? "videos" : input.folder === "thumbnails" ? "thumbnails" : "images";
  const token = randomBytes(12).toString("hex");
  const now = new Date();
  const year = String(now.getUTCFullYear());
  const objectKey = `fastsewa/${folder}/${year}/${token}${extensionFor(input.kind, contentType)}`;
  const expiresAt = new Date(now.getTime() + TICKET_TTL_SECONDS * 1000).toISOString();

  const [row] = await db
    .insert(mediaUploads)
    .values({
      provider,
      kind: input.kind,
      objectKey,
      contentType,
      declaredBytes: Math.min(input.bytes, 2_147_483_647),
      createdBy: actor.id,
    })
    .returning();

  if (provider === "s3") {
    const s3 = config.media.s3!;
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
    const url = await getSignedUrl(
      await s3Client(),
      new PutObjectCommand({ Bucket: s3.bucket, Key: objectKey, ContentType: contentType, ContentLength: input.bytes }),
      { expiresIn: TICKET_TTL_SECONDS, signableHeaders: new Set(["content-type", "content-length"]) }
    );
    return { uploadId: row.id, provider, method: "PUT", url, headers: { "Content-Type": contentType }, expiresAt, maxBytes };
  }

  if (provider === "cloudinary") {
    const c = config.media.cloudinary!;
    const { v2 } = await import("cloudinary");
    const timestamp = Math.floor(now.getTime() / 1000);
    const publicId = objectKey.replace(/\.[a-z0-9]+$/i, "");
    const toSign = { public_id: publicId, timestamp };
    const signature = v2.utils.api_sign_request(toSign, c.apiSecret);
    return {
      uploadId: row.id,
      provider,
      method: "POST",
      url: `https://api.cloudinary.com/v1_1/${c.cloudName}/${input.kind}/upload`,
      fields: { api_key: c.apiKey, timestamp: String(timestamp), public_id: publicId, signature },
      fileField: "file",
      expiresAt,
      maxBytes,
    };
  }

  // local: the browser posts the file to this API, which streams it to disk
  return {
    uploadId: row.id,
    provider: "local",
    method: "POST",
    url: `/api/v1/admin/media/upload/${row.id}`,
    fileField: "file",
    expiresAt,
    maxBytes,
  };
}

let s3Singleton: import("@aws-sdk/client-s3").S3Client | null = null;
async function s3Client() {
  if (!s3Singleton) {
    const { S3Client } = await import("@aws-sdk/client-s3");
    const s3 = config.media.s3!;
    s3Singleton = new S3Client({
      region: s3.region,
      ...(s3.endpoint ? { endpoint: s3.endpoint } : {}),
      forcePathStyle: s3.forcePathStyle,
    });
  }
  return s3Singleton;
}

function publicUrlForKey(key: string): string {
  const { publicBaseUrl, s3 } = config.media;
  if (publicBaseUrl) return `${publicBaseUrl}/${key}`;
  if (!s3) throw err("MEDIA_NOT_CONFIGURED");
  if (s3.endpoint) return `${s3.endpoint.replace(/\/+$/, "")}/${s3.bucket}/${key}`;
  return `https://${s3.bucket}.s3.${s3.region}.amazonaws.com/${key}`;
}

async function loadTicket(actor: { id: string; role: string }, uploadId: string) {
  const [row] = await db.select().from(mediaUploads).where(eq(mediaUploads.id, uploadId)).limit(1);
  if (!row) throw err("MEDIA_UPLOAD_NOT_FOUND");
  if (row.createdBy !== actor.id && actor.role !== "admin") throw err("FORBIDDEN");
  return row;
}

async function markReady(id: string, url: string) {
  await db.update(mediaUploads).set({ status: "ready", url, completedAt: new Date() }).where(eq(mediaUploads.id, id));
}

/** Verifies the stored object and returns the URL lessons should use. */
export async function completeUpload(
  actor: { id: string; role: string },
  input: { uploadId: string; url?: string }
): Promise<{ url: string; kind: MediaKind }> {
  const row = await loadTicket(actor, input.uploadId);
  const kind = row.kind as MediaKind;
  if (row.status === "ready" && row.url) return { url: row.url, kind };

  if (row.provider === "s3") {
    const s3 = config.media.s3!;
    const { HeadObjectCommand, GetObjectCommand, DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await s3Client();
    const reject = async (code: "MEDIA_TYPE_NOT_ALLOWED" | "MEDIA_TOO_LARGE") => {
      await client.send(new DeleteObjectCommand({ Bucket: s3.bucket, Key: row.objectKey })).catch(() => undefined);
      await db.delete(mediaUploads).where(eq(mediaUploads.id, row.id));
      throw err(code);
    };
    let head;
    try {
      head = await client.send(new HeadObjectCommand({ Bucket: s3.bucket, Key: row.objectKey }));
    } catch {
      throw err("MEDIA_UPLOAD_NOT_FOUND");
    }
    const maxBytes = kind === "image" ? config.media.maxImageBytes : config.media.maxVideoBytes;
    if ((head.ContentLength ?? 0) > maxBytes) return reject("MEDIA_TOO_LARGE");
    const obj = await client.send(new GetObjectCommand({ Bucket: s3.bucket, Key: row.objectKey, Range: "bytes=0-31" }));
    const headBytes = Buffer.from(await obj.Body!.transformToByteArray());
    const sniffed = sniffContentType(headBytes);
    if (!sniffed || !typesCompatible(row.contentType, sniffed)) return reject("MEDIA_TYPE_NOT_ALLOWED");
    const url = publicUrlForKey(row.objectKey);
    await markReady(row.id, url);
    return { url, kind };
  }

  if (row.provider === "cloudinary") {
    const c = config.media.cloudinary!;
    const url = input.url ? parseUrl(input.url) : null;
    const publicId = row.objectKey.replace(/\.[a-z0-9]+$/i, "");
    if (
      !url ||
      url.protocol !== "https:" ||
      url.hostname !== "res.cloudinary.com" ||
      !url.pathname.startsWith(`/${c.cloudName}/${kind}/upload/`) ||
      !url.pathname.includes(`/${publicId}`)
    ) {
      throw err("MEDIA_UPLOAD_NOT_FOUND");
    }
    await markReady(row.id, url.toString());
    return { url: url.toString(), kind };
  }

  // local uploads are completed by the upload request itself
  throw err("MEDIA_UPLOAD_NOT_FOUND");
}

// ─── Local provider ──────────────────────────────────────────────────────────
export async function getLocalTicket(actor: { id: string; role: string }, uploadId: string) {
  const row = await loadTicket(actor, uploadId);
  if (row.provider !== "local") throw notFound("Upload");
  if (row.status !== "pending") throw err("CONFLICT", { message: "This upload has already been completed" });
  if (Date.now() - row.createdAt.getTime() > TICKET_TTL_SECONDS * 1000) throw err("MEDIA_UPLOAD_NOT_FOUND", { message: "Upload ticket expired" });
  return row;
}

export function localTmpDir(): string {
  return join(config.media.localDir, "_tmp");
}

/** Validates the file multer wrote (real content type, extension chosen by us) and publishes it. */
export async function finalizeLocalUpload(
  ticket: typeof mediaUploads.$inferSelect,
  file: { path: string; size: number },
  origin: string
): Promise<{ url: string; kind: MediaKind }> {
  const kind = ticket.kind as MediaKind;
  try {
    const fh = await open(file.path, "r");
    const head = Buffer.alloc(32);
    try {
      await fh.read(head, 0, 32, 0);
    } finally {
      await fh.close();
    }
    const sniffed = sniffContentType(head);
    if (!sniffed || !typesCompatible(ticket.contentType, sniffed)) throw err("MEDIA_TYPE_NOT_ALLOWED");

    const ext = extensionFor(kind, sniffed) || extname(ticket.objectKey);
    const relative = ticket.objectKey.replace(/^fastsewa\//, "").replace(/\.[a-z0-9]+$/i, "") + ext;
    const destination = join(config.media.localDir, relative);
    await mkdir(join(destination, ".."), { recursive: true });
    await rename(file.path, destination);

    const url = `${config.publicBaseUrl ?? origin}/uploads/${relative}`;
    await markReady(ticket.id, url);
    return { url, kind };
  } catch (error) {
    await rm(file.path, { force: true });
    throw error;
  }
}

// ─── Housekeeping ────────────────────────────────────────────────────────────
/** Drops tickets that were never completed (abandoned uploads) and the objects behind them. */
export async function purgePendingUploads(olderThanHours = 24): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanHours * 3600_000);
  const stale = await db
    .select()
    .from(mediaUploads)
    .where(and(eq(mediaUploads.status, "pending"), lt(mediaUploads.createdAt, cutoff)))
    .limit(500);
  for (const row of stale) {
    try {
      if (row.provider === "s3" && config.media.s3) {
        const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
        await (await s3Client()).send(new DeleteObjectCommand({ Bucket: config.media.s3.bucket, Key: row.objectKey }));
      }
    } catch (error) {
      logger.warn({ err: error, key: row.objectKey }, "could not delete abandoned upload object");
    }
    await db.delete(mediaUploads).where(eq(mediaUploads.id, row.id));
  }
  return stale.length;
}
