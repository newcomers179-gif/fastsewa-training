import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { config } from "../config";
import { sniffContentType, validateMediaUrl, videoProviderOf } from "../services/media";

const original = structuredClone(config.media);
afterEach(() => {
  Object.assign(config.media, structuredClone(original));
});

const allowed = (url: string, kind: "image" | "video" = "video") => {
  try {
    return validateMediaUrl(url, kind);
  } catch (error) {
    assert.equal((error as { code?: string }).code, "MEDIA_URL_NOT_ALLOWED", `${url} failed for another reason`);
    return null;
  }
};

describe("media URL allow-list", () => {
  it("normalises YouTube links for video lessons only", () => {
    assert.equal(allowed("https://youtu.be/dQw4w9WgXcQ?t=5"), "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    assert.equal(allowed("https://www.youtube.com/embed/dQw4w9WgXcQ"), "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    assert.equal(allowed("https://youtu.be/dQw4w9WgXcQ", "image"), null, "a video link is not an image");
    assert.equal(allowed("https://www.youtube.com/channel/UC123"), null, "no video id");
  });

  it("refuses arbitrary hosts, other schemes and tricks", () => {
    for (const url of [
      "https://evil.example.com/video.mp4",
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "file:///etc/passwd",
      "ftp://example.com/x.mp4",
      "https://user:pass@www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://www.youtube.com.evil.example.com/watch?v=dQw4w9WgXcQ",
      "https://evil.example.com/?u=https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "//evil.example.com/x.png",
      "",
      `https://www.youtube.com/watch?v=dQw4w9WgXcQ&${"a".repeat(3000)}`,
    ]) {
      assert.equal(allowed(url), null, url.slice(0, 80));
      assert.equal(allowed(url, "image"), null, url.slice(0, 80));
    }
  });

  it("accepts locally stored uploads but not path traversal", () => {
    config.media.provider = "local";
    assert.equal(allowed("/uploads/images/2026/abc.png", "image"), "/uploads/images/2026/abc.png");
    assert.equal(allowed("/uploads/../etc/passwd", "image"), null);
    config.media.provider = "none";
    assert.equal(allowed("/uploads/images/2026/abc.png", "image"), null);
  });

  it("accepts the configured S3 bucket and nothing else on amazonaws.com", () => {
    config.media.provider = "s3";
    config.media.s3 = { bucket: "fastsewa-media", region: "ap-south-1", endpoint: null, forcePathStyle: false };
    assert.ok(allowed("https://fastsewa-media.s3.ap-south-1.amazonaws.com/fastsewa/videos/2026/a.mp4"));
    assert.equal(allowed("https://other-bucket.s3.ap-south-1.amazonaws.com/a.mp4"), null);
    assert.equal(allowed("https://s3.ap-south-1.amazonaws.com/fastsewa-media/a.mp4"), null);
  });

  it("accepts the configured CDN base and Cloudinary account, scoped to their own paths", () => {
    config.media.publicBaseUrl = "https://cdn.example.com/media";
    assert.ok(allowed("https://cdn.example.com/media/videos/a.mp4"));
    assert.equal(allowed("https://cdn.example.com/other/a.mp4"), null);
    assert.equal(allowed("https://cdn.example.com.evil.com/media/a.mp4"), null);

    config.media.cloudinary = { cloudName: "fastsewa", apiKey: "k", apiSecret: "s" };
    assert.ok(allowed("https://res.cloudinary.com/fastsewa/video/upload/v1/a.mp4"));
    assert.equal(allowed("https://res.cloudinary.com/someone-else/video/upload/v1/a.mp4"), null);
  });

  it("classifies the provider from the URL", () => {
    assert.equal(videoProviderOf("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), "youtube");
    assert.equal(videoProviderOf("/uploads/videos/2026/a.mp4"), "local");
    assert.equal(videoProviderOf("https://res.cloudinary.com/x/video/upload/a.mp4"), "cloudinary");
    assert.equal(videoProviderOf("https://b.s3.ap-south-1.amazonaws.com/a.mp4"), "s3");
    assert.equal(videoProviderOf("https://cdn.example.com/a.mp4"), "external");
  });
});

describe("upload content sniffing", () => {
  const pad = (...bytes: number[]) => Buffer.concat([Buffer.from(bytes), Buffer.alloc(32)]);

  it("recognises real image and video containers from their first bytes", () => {
    assert.equal(sniffContentType(pad(0xff, 0xd8, 0xff, 0xe0)), "image/jpeg");
    assert.equal(sniffContentType(pad(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)), "image/png");
    assert.equal(sniffContentType(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 "), Buffer.alloc(8)])), "image/webp");
    assert.equal(sniffContentType(Buffer.concat([Buffer.alloc(4), Buffer.from("ftypisom"), Buffer.alloc(8)])), "video/mp4");
    assert.equal(sniffContentType(Buffer.concat([Buffer.alloc(4), Buffer.from("ftypqt  "), Buffer.alloc(8)])), "video/quicktime");
    assert.equal(sniffContentType(pad(0x1a, 0x45, 0xdf, 0xa3)), "video/webm");
  });

  it("returns null for HTML, SVG, scripts and empty files (whatever the extension claims)", () => {
    for (const body of ["<html><script>alert(1)</script></html>", '<svg xmlns="http://www.w3.org/2000/svg"/>', "GIF89a", "#!/bin/sh\nrm -rf /", ""]) {
      assert.equal(sniffContentType(Buffer.from(body)), null, body);
    }
  });
});
