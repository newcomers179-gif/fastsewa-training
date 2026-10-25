import { Router } from "express";
import { desc, eq } from "drizzle-orm";
import { certificates, courses, users } from "@shared/schema";
import { db } from "../db";
import { err, notFound } from "../errors";
import { signLink, verifyLink } from "../auth/tokens";
import { authenticate, requireAuth } from "../middleware/auth";
import type { Limiters } from "../middleware/rateLimit";
import { renderCertificatePdf } from "../services/certificate";
import { originOf } from "../utils/origin";
import { idParam } from "../utils/params";

const LINK_TTL_SECONDS = 5 * 60;

export function certificatesRoutes(l: Limiters): Router {
  const r = Router();

  // GET /certificates — my certificates
  r.get("/", requireAuth, l.authenticated, async (req, res) => {
    const rows = await db
      .select({
        id: certificates.id,
        certificateNumber: certificates.certificateNumber,
        earnedAt: certificates.earnedAt,
        revokedAt: certificates.revokedAt,
        issuedCourseTitle: certificates.issuedCourseTitle,
        courseId: certificates.courseId,
        courseTitle: courses.title,
        courseTitleHi: courses.titleHi,
        courseCategory: courses.category,
      })
      .from(certificates)
      .innerJoin(courses, eq(courses.id, certificates.courseId))
      .where(eq(certificates.userId, req.user!.id))
      .orderBy(desc(certificates.earnedAt));

    res.json(
      rows.map((c) => ({
        id: c.id,
        certificateNumber: c.certificateNumber,
        earnedAt: c.earnedAt,
        revoked: c.revokedAt !== null,
        courseId: c.courseId,
        courseTitle: c.issuedCourseTitle ?? c.courseTitle,
        courseTitleHi: c.courseTitleHi,
        courseCategory: c.courseCategory,
      }))
    );
  });

  /**
   * GET /certificates/:id/download-link — a short-lived URL that downloads the PDF without an
   * Authorization header. A phone's browser or share sheet cannot send the app's bearer token,
   * which is why the old "download" button never worked.
   */
  r.get("/:id/download-link", requireAuth, l.authenticated, l.certificate, async (req, res) => {
    const id = idParam(req, "id", "Certificate");
    const [cert] = await db
      .select({ id: certificates.id, userId: certificates.userId, revokedAt: certificates.revokedAt })
      .from(certificates)
      .where(eq(certificates.id, id))
      .limit(1);
    if (!cert || cert.userId !== req.user!.id || cert.revokedAt) throw notFound("Certificate");

    const { exp, sig } = signLink(`cert:${id}`, LINK_TTL_SECONDS);
    res.json({
      url: `${originOf(req)}/api/v1/certificates/${id}/pdf?exp=${exp}&sig=${sig}`,
      expiresAt: new Date(exp * 1000).toISOString(),
    });
  });

  // GET /certificates/:id/pdf — with a bearer token (own certificate) or a signed link
  r.get("/:id/pdf", l.certificate, async (req, res) => {
    const id = idParam(req, "id", "Certificate");

    let viewer: { id: string; role: string } | null = null;
    if (typeof req.query.sig === "string") {
      if (!verifyLink(`cert:${id}`, req.query.exp, req.query.sig)) {
        throw err("UNAUTHORIZED", { message: "This download link is invalid or has expired" });
      }
    } else {
      await authenticate(req);
      viewer = req.user!;
    }

    const [cert] = await db
      .select({
        number: certificates.certificateNumber,
        earnedAt: certificates.earnedAt,
        userId: certificates.userId,
        revokedAt: certificates.revokedAt,
        issuedName: certificates.issuedName,
        issuedCourseTitle: certificates.issuedCourseTitle,
        workerName: users.displayName,
        courseTitle: courses.title,
        courseTitleHi: courses.titleHi,
      })
      .from(certificates)
      .innerJoin(users, eq(users.id, certificates.userId))
      .innerJoin(courses, eq(courses.id, certificates.courseId))
      .where(eq(certificates.id, id))
      .limit(1);

    if (!cert || cert.revokedAt) throw notFound("Certificate");
    if (viewer && viewer.id !== cert.userId && viewer.role !== "admin") throw notFound("Certificate");

    const pdf = await renderCertificatePdf({
      certificateNumber: cert.number,
      holderName: cert.issuedName ?? cert.workerName,
      courseTitle: cert.issuedCourseTitle ?? cert.courseTitle,
      courseTitleHi: cert.courseTitleHi,
      earnedAt: cert.earnedAt,
      fallbackOrigin: originOf(req),
    });

    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `${req.query.inline === "1" ? "inline" : "attachment"}; filename="certificate-${cert.number}.pdf"`,
      "Content-Length": String(pdf.length),
      "Cache-Control": "private, no-store",
    });
    res.end(pdf);
  });

  return r;
}
