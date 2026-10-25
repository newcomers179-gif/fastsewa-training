import { Router } from "express";
import { config } from "../config";
import type { Limiters } from "../middleware/rateLimit";
import { isEmailConfigured } from "../services/email";

/**
 * Public, unauthenticated runtime configuration for the mobile app. Lets the
 * app adapt without a new release: hide "Forgot password" when e-mail is not
 * set up, ask for a registration code, show the right privacy-policy link and
 * the support contact that real workers should call.
 */
export function configRoutes(l: Limiters): Router {
  const r = Router();
  r.get("/", l.anonymous, (_req, res) => {
    res.json({
      apiVersion: 1,
      registrationMode: config.registration.mode,
      registrationCodeRequired: config.registration.mode === "code",
      passwordResetByEmail: isEmailConfigured(),
      consentVersion: config.legal.consentVersion,
      privacyPolicyUrl: config.legal.privacyPolicyUrl,
      termsUrl: config.legal.termsUrl,
      supportEmail: config.legal.supportEmail,
      supportPhone: config.legal.supportPhone,
      serverTime: new Date().toISOString(),
    });
  });
  return r;
}
