import React, { useRef, useState } from "react";
import { TextInput } from "react-native";
import { useTranslation } from "react-i18next";
import { BrandHeader } from "@/components/BrandHeader";
import { LanguageSwitch } from "@/components/LanguageSwitch";
import { SupportLine } from "@/components/SupportLine";
import { ThemedText } from "@/components/ThemedText";
import { Banner, Button, FormScroll, Screen, TextField } from "@/components/ui";
import { useAppConfig } from "@/hooks/useAppConfig";
import { useAuth } from "@/hooks/useAuth";
import { errorMessage } from "@/lib/errors";
import { onlyProblems, validateRequired } from "@/lib/validation";
import type { ScreenProps } from "@/navigation/hooks";

export default function LoginScreen({ navigation, route }: ScreenProps<"Login">) {
  const { t } = useTranslation();
  const { login, notice, dismissNotice } = useAuth();
  const { config } = useAppConfig();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const passwordRef = useRef<TextInput>(null);

  const submit = async () => {
    const found = onlyProblems({ username: validateRequired(username), password: password === "" ? "validation.required" : null });
    setProblems(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    setError(null);
    dismissNotice();
    try {
      await login(username, password);
      // Signed in: the navigator replaces this screen, nothing more to do here.
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };

  return (
    <Screen>
      <FormScroll>
        <BrandHeader title={t("common.appName")} subtitle={t("auth.tagline")} />
        <LanguageSwitch />
        {route.params?.notice === "passwordReset" ? <Banner tone="success">{t("auth.login.passwordWasReset")}</Banner> : null}
        {notice === "sessionEnded" ? <Banner tone="warning">{t("auth.login.sessionEnded")}</Banner> : null}
        {error ? <Banner tone="error">{errorMessage(error, t)}</Banner> : null}

        <TextField
          label={t("auth.login.username")}
          hint={t("auth.login.usernameHint")}
          value={username}
          onChangeText={(v) => {
            setUsername(v);
            setProblems((p) => ({ ...p, username: "" }));
          }}
          error={problems.username ? t(problems.username) : undefined}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="username"
          textContentType="username"
          returnKeyType="next"
          onSubmitEditing={() => passwordRef.current?.focus()}
        />
        <TextField
          ref={passwordRef}
          label={t("auth.login.password")}
          value={password}
          onChangeText={(v) => {
            setPassword(v);
            setProblems((p) => ({ ...p, password: "" }));
          }}
          error={problems.password ? t(problems.password) : undefined}
          secure
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={() => void submit()}
        />
        <Button label={t("auth.login.submit")} onPress={() => void submit()} loading={busy} />

        {config.passwordResetByEmail ? <Button variant="ghost" label={t("auth.login.forgot")} onPress={() => navigation.navigate("ForgotPassword")} /> : null}
        {config.registrationMode === "closed" ? (
          <ThemedText muted style={{ textAlign: "center" }}>
            {t("auth.login.registrationClosed")}
          </ThemedText>
        ) : (
          <Button variant="secondary" label={t("auth.login.create")} onPress={() => navigation.navigate("Register")} />
        )}
        <SupportLine config={config} />
      </FormScroll>
    </Screen>
  );
}
