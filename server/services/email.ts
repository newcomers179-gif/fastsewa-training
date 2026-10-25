/**
 * Transactional e-mail (password-reset codes) over plain SMTP via nodemailer,
 * so any provider works (Resend, Brevo, SES, Mailgun, Gmail, ...).
 *
 * Reset codes are secrets: they are never written to the logs. If SMTP is not
 * configured the API reports `passwordResetByEmail: false` in GET /config and
 * the app tells workers to ask their trainer (admins can issue a temporary
 * password); only in a local development run is the code printed to the
 * console, clearly marked, so the flow can be tried without a mail server.
 */
import nodemailer, { type Transporter } from "nodemailer";
import { config } from "../config";
import { logger } from "../logger";

let transporter: Transporter | null = null;

/** Test hook: messages "sent" while NODE_ENV=test and no SMTP is configured. */
export const testOutbox: { to: string; subject: string; text: string; code?: string }[] = [];

export function isEmailConfigured(): boolean {
  return !!config.smtp || config.isTest;
}

function getTransporter(): Transporter | null {
  if (transporter) return transporter;
  const smtp = config.smtp;
  if (!smtp) return null;
  transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465,
    auth: { user: smtp.user, pass: smtp.password },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  return transporter;
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

export async function sendPasswordResetEmail(toEmail: string, code: string, displayName: string): Promise<void> {
  const subject = "FastSewa password reset code / पासवर्ड रीसेट कोड";
  const text =
    `Hi ${displayName},\n\n` +
    `Your FastSewa password reset code is: ${code}\n` +
    `Enter it in the app to choose a new password. It expires in 30 minutes.\n` +
    `If you did not ask for this, ignore this email — your password has not changed.\n\n` +
    `नमस्ते ${displayName},\n\n` +
    `आपका FastSewa पासवर्ड रीसेट कोड: ${code}\n` +
    `नया पासवर्ड बनाने के लिए इसे ऐप में डालें। यह 30 मिनट में समाप्त हो जाएगा।\n` +
    `अगर आपने यह अनुरोध नहीं किया है, तो इस ईमेल को अनदेखा करें — आपका पासवर्ड नहीं बदला है।\n`;
  const html =
    `<p>Hi ${escapeHtml(displayName)},</p>` +
    `<p>Your FastSewa password reset code is:</p>` +
    `<p style="font-size:28px;font-weight:700;letter-spacing:4px">${escapeHtml(code)}</p>` +
    `<p>Enter it in the app to choose a new password. It expires in 30 minutes. If you did not ask for this, ignore this email.</p>` +
    `<hr/><p>नमस्ते ${escapeHtml(displayName)}, आपका पासवर्ड रीसेट कोड ऊपर दिया गया है। यह 30 मिनट में समाप्त हो जाएगा। अगर आपने यह अनुरोध नहीं किया है, तो इस ईमेल को अनदेखा करें।</p>`;

  if (config.isTest && !config.smtp) {
    testOutbox.push({ to: toEmail, subject, text, code });
    return;
  }

  const t = getTransporter();
  if (!t) {
    if (config.isDev) {
      logger.warn({ to: toEmail }, `[DEV ONLY] SMTP is not configured. Password reset code: ${code}`);
    }
    return;
  }
  await t.sendMail({ from: config.smtp!.from, to: toEmail, subject, text, html });
}
