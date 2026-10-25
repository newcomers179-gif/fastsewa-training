import React, { useCallback, useState } from "react";
import { Linking, Share } from "react-native";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { API_BASE_URL } from "@/lib/config";
import { pick } from "@/lib/format";
import type { DownloadLink, Lang } from "@/types";

/**
 * Opening and sharing a certificate. The PDF itself is behind the learner's sign-in, so the app asks
 * the server for a link that works for five minutes without one and hands that to the phone's browser
 * or PDF viewer. What gets *shared* is the public verification page instead (it never expires, and is
 * what an employer needs: a place to check the certificate is genuine).
 */
export function useCertificateActions() {
  const { t } = useTranslation();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const download = useCallback(async (certificateId: string) => {
    setBusyId(certificateId);
    setError(null);
    try {
      const link = await api.get<DownloadLink>(`/certificates/${certificateId}/download-link`);
      await Linking.openURL(link.url);
    } catch (e) {
      setError(e);
    } finally {
      setBusyId(null);
    }
  }, []);

  const share = useCallback(
    async (certificate: { certificateNumber: string; courseTitle: string; courseTitleHi: string | null }, lang: Lang) => {
      const url = `${API_BASE_URL}/verify/${encodeURIComponent(certificate.certificateNumber)}`;
      const course = pick(lang, certificate.courseTitle, certificate.courseTitleHi);
      try {
        await Share.share({ message: t("profile.shareMessage", { course, url }) });
      } catch (e) {
        setError(e);
      }
    },
    [t]
  );

  return { download, share, busyId, error, clearError: React.useCallback(() => setError(null), []) };
}
