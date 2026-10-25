import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { ThemedText } from "@/components/ThemedText";
import { Banner, Button, FormScroll, Screen, TextField } from "@/components/ui";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { validateEmail } from "@/lib/validation";
import type { ScreenProps } from "@/navigation/hooks";

export default function ForgotPasswordScreen({ navigation }: ScreenProps<"ForgotPassword">) {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const found = validateEmail(email, true);
    setProblem(found ? t(found) : null);
    if (found) return;
    setBusy(true);
    setError(null);
    try {
      await api.post("/auth/forgot-password", { email: email.trim() }, { auth: false });
      // The server answers the same whether or not the address is registered; so does the next screen.
      navigation.navigate("ResetPassword", { email: email.trim() });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={["bottom", "left", "right"]}>
      <FormScroll>
        <ThemedText>{t("auth.forgot.intro")}</ThemedText>
        {error ? <Banner tone="error">{errorMessage(error, t)}</Banner> : null}
        <TextField label={t("auth.forgot.email")} value={email} onChangeText={(v) => { setEmail(v); setProblem(null); }} error={problem ?? undefined} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" textContentType="emailAddress" returnKeyType="go" onSubmitEditing={() => void submit()} />
        <Button label={t("auth.forgot.submit")} onPress={() => void submit()} loading={busy} />
        <Button variant="ghost" label={t("auth.forgot.haveCode")} onPress={() => navigation.navigate("ResetPassword", { email: email.trim() })} />
        <ThemedText type="small" muted>
          {t("auth.forgot.noEmail")}
        </ThemedText>
      </FormScroll>
    </Screen>
  );
}
