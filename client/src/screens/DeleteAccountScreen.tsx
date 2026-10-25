import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { ThemedText } from "@/components/ThemedText";
import { Banner, Button, Checkbox, FormScroll, Screen, TextField } from "@/components/ui";
import { useAuth } from "@/hooks/useAuth";
import { confirmAction } from "@/lib/confirm";
import { errorMessage, fieldErrors, isFieldError } from "@/lib/errors";

/** DPDP "right to erasure": the person deletes their own account and records. Needs the password, so a found phone cannot do it. */
export default function DeleteAccountScreen() {
  const { t } = useTranslation();
  const { deleteAccount } = useAuth();
  const [password, setPassword] = useState("");
  const [understood, setUnderstood] = useState(false);
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const found: Record<string, string> = {};
    if (!understood) found.understood = t("profile.deleteUnderstandRequired");
    if (password === "") found.password = t("validation.required");
    setProblems(found);
    if (Object.keys(found).length > 0) return;

    const sure = await confirmAction({ title: t("profile.deleteConfirmTitle"), message: t("profile.deleteConfirmBody"), confirmLabel: t("profile.deleteConfirm"), cancelLabel: t("common.cancel"), destructive: true });
    if (!sure) return;

    setBusy(true);
    setError(null);
    try {
      await deleteAccount(password);
      // Deleted: the navigator is already showing the login screen.
    } catch (e) {
      const fields = fieldErrors(e, t);
      if (fields.currentPassword) fields.password = fields.currentPassword;
      setProblems(fields);
      setError(isFieldError(e) ? null : e);
      setBusy(false);
    }
  };

  return (
    <Screen edges={["bottom", "left", "right"]}>
      <FormScroll>
        <Banner tone="warning" icon="alert-triangle">
          {t("profile.deleteWarning")}
        </Banner>
        <ThemedText>{t("profile.deleteWhat")}</ThemedText>
        {error ? <Banner tone="error">{errorMessage(error, t)}</Banner> : null}
        <TextField label={t("profile.deletePassword")} value={password} onChangeText={(v) => { setPassword(v); setProblems((p) => ({ ...p, password: "" })); }} error={problems.password || undefined} secure autoCapitalize="none" autoCorrect={false} autoComplete="current-password" textContentType="password" />
        <Checkbox checked={understood} onChange={(v) => { setUnderstood(v); setProblems((p) => ({ ...p, understood: "" })); }} error={problems.understood || undefined}>
          <ThemedText>{t("profile.deleteUnderstand")}</ThemedText>
        </Checkbox>
        <Button label={t("profile.deleteConfirm")} variant="danger" icon="trash-2" onPress={() => void submit()} loading={busy} />
      </FormScroll>
    </Screen>
  );
}
