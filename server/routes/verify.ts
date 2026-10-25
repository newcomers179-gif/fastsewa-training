/**
 * Public certificate verification — the page the QR code on every certificate
 * opens, and the JSON behind it. No login: an employer or inspector must be
 * able to check a certificate. Numbers are ~59 random bits, so they cannot be
 * guessed or enumerated, and the answer reveals only what is printed on the
 * certificate itself (holder name, course, date).
 */
import { Router } from "express";
import { eq } from "drizzle-orm";
import { certificates, courses, users } from "@shared/schema";
import { db } from "../db";
import { notFound } from "../errors";
import type { Limiters } from "../middleware/rateLimit";
import { parseCertificateNumber } from "../services/certificate";
import { paramStr } from "../utils/params";

export interface VerifyResult {
  status: "valid" | "revoked";
  valid: boolean;
  certificateNumber: string;
  holderName: string;
  courseTitle: string;
  issuedOn: string;
}

export async function lookupCertificate(raw: string): Promise<VerifyResult | null> {
  const number = parseCertificateNumber(raw);
  if (!number) return null;
  const [row] = await db
    .select({
      number: certificates.certificateNumber,
      earnedAt: certificates.earnedAt,
      revokedAt: certificates.revokedAt,
      issuedName: certificates.issuedName,
      issuedCourseTitle: certificates.issuedCourseTitle,
      workerName: users.displayName,
      courseTitle: courses.title,
    })
    .from(certificates)
    .innerJoin(users, eq(users.id, certificates.userId))
    .innerJoin(courses, eq(courses.id, certificates.courseId))
    .where(eq(certificates.certificateNumber, number))
    .limit(1);
  if (!row) return null;
  const revoked = row.revokedAt !== null;
  return {
    status: revoked ? "revoked" : "valid",
    valid: !revoked,
    certificateNumber: row.number,
    holderName: row.issuedName ?? row.workerName,
    courseTitle: row.issuedCourseTitle ?? row.courseTitle,
    issuedOn: row.earnedAt.toISOString().slice(0, 10),
  };
}

/** GET /api/v1/verify/:number */
export function verifyApiRoutes(l: Limiters): Router {
  const r = Router();
  r.get("/:number", l.publicVerify, async (req, res) => {
    const result = await lookupCertificate(paramStr(req.params.number));
    if (!result) throw notFound("Certificate");
    res.json(result);
  });
  return r;
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

function page(title: string, tone: "ok" | "bad", body: string): string {
  const color = tone === "ok" ? "#1B7F3B" : "#B3261E";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>${escapeHtml(title)} · FastSewa</title>
<style>
body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans","Noto Sans Devanagari",sans-serif;background:#FFFDF7;color:#2C2C2C}
main{max-width:520px;margin:0 auto;padding:32px 20px}
.brand{color:#FF6B2C;font-weight:700;letter-spacing:.06em;font-size:13px}
.card{margin-top:16px;padding:24px;border:1px solid #E8E2D4;border-radius:14px;background:#fff}
.status{font-size:22px;font-weight:700;color:${color}}
dl{margin:20px 0 0}dt{font-size:12px;color:#777;text-transform:uppercase;letter-spacing:.04em;margin-top:14px}dd{margin:2px 0 0;font-size:17px;word-break:break-word}
p.note{color:#777;font-size:13px;margin-top:20px}
</style></head><body><main>
<div class="brand">FASTSEWA CONSTRUCTION TRAINING</div>
<div class="card">${body}</div>
</main></body></html>`;
}

/** GET /verify/:number — the human-readable page behind the certificate's QR code. */
export function verifyPageRoutes(l: Limiters): Router {
  const r = Router();
  r.get("/:number", l.publicVerify, async (req, res) => {
    const result = await lookupCertificate(paramStr(req.params.number));
    res.set({
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    });

    if (!result) {
      res.status(404).send(
        page(
          "Certificate not found",
          "bad",
          `<div class="status">Certificate not found</div>
           <p class="note">We could not find a certificate with that number. Check the number printed on the certificate and try again.<br>
           प्रमाणपत्र नहीं मिला — कृपया प्रमाणपत्र पर छपा नंबर जाँचें।</p>`
        )
      );
      return;
    }

    const heading = result.valid ? "Valid certificate ✓ / मान्य प्रमाणपत्र" : "Certificate revoked / प्रमाणपत्र रद्द";
    res.send(
      page(
        heading,
        result.valid ? "ok" : "bad",
        `<div class="status">${escapeHtml(heading)}</div>
         <dl>
           <dt>Awarded to / प्रदान किया गया</dt><dd>${escapeHtml(result.holderName)}</dd>
           <dt>Course / कोर्स</dt><dd>${escapeHtml(result.courseTitle)}</dd>
           <dt>Issued on / जारी तिथि</dt><dd>${escapeHtml(result.issuedOn)}</dd>
           <dt>Certificate No.</dt><dd>${escapeHtml(result.certificateNumber)}</dd>
         </dl>
         ${result.valid ? "" : `<p class="note">This certificate has been withdrawn by the issuer and is no longer valid.</p>`}`
      )
    );
  });
  return r;
}
