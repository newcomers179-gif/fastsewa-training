import React, { useRef, useState } from "react";
import { TextInput } from "react-native";
import { useTranslation } from "react-i18next";
import { ThemedText } from "@/components/ThemedText";
import { Banner, Button, FormScroll, Screen, TextField } from "@/components/ui";
import { api } from "@/lib/api";
import { errorMessage, fieldErrors, isFieldError } from "@/lib/errors";
import { onlyProblems, validateConfirmation, validateEmail, validateNewPassword } from "@/lib/validation";
import type { ScreenProps } from "@/navigation/hooks";

export default function ResetPasswordScreen({ navigation, route }: ScreenProps<"ResetPassword">) {
  const { t } = useTranslation();
  const [email, setEmail] = useState(route.params.email);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const passwordRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);

  const clear = (field: string) => setProblems((p) => ({ ...p, [field]: "" }));

  const submit = async () => {
    const found = onlyProblems({
      email: validateEmail(email, true),
      code: code.trim().length >= 6 ? null : "validation.code",
      newPassword: validateNewPassword(password),
      confirm: validateConfirmation(password, confirm),
    });
    const translated = Object.fromEntries(Object.entries(found).map(([field, key]) => [field, t(key)]));
    setProblems(translated);
    if (Object.keys(translated).length > 0) return;
    setBusy(true);
    setError(null);
    try {
      await api.post("/auth/reset-password", { email: email.trim(), code: code.trim(), newPassword: password }, { auth: false });
      navigation.popTo("Login", { notice: "passwordReset" });
    } catch (e) {
      const fields = fieldErrors(e, t);
      // The server names the field `newPassword` for password-policy errors.
      if (fields.password) fields.newPassword = fields.password;
      setProblems(fields);
      setError(isFieldError(e) ? null : e);
      setBusy(false);
    }
  };

  return (
    <Screen edges={["bottom", "left", "right"]}>
      <FormScroll>
        <ThemedText>{t("auth.reset.intro")}</ThemedText>
        {error ? <Banner tone="error">{errorMessage(error, t)}</Banner> : null}
        <TextField label={t("auth.forgot.email")} value={email} onChangeText={(v) => { setEmail(v); clear("email"); }} error={problems.email || undefined} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" returnKeyType="next" />
        <TextField label={t("auth.reset.code")} hint={t("auth.reset.codeHint")} value={code} onChangeText={(v) => { setCode(v); clear("code"); }} error={problems.code || undefined} autoCapitalize="characters" autoCorrect={false} returnKeyType="next" onSubmitEditing={() => passwordRef.current?.focus()} />
        <TextField ref={passwordRef} label={t("auth.reset.newPassword")} hint={t("auth.register.passwordHint")} value={password} onChangeText={(v) => { setPassword(v); clear("newPassword"); }} error={problems.newPassword || undefined} secure autoCapitalize="none" autoCorrect={false} autoComplete="new-password" textContentType="newPassword" returnKeyType="next" onSubmitEditing={() => confirmRef.current?.focus()} />
        <TextField ref={confirmRef} label={t("auth.reset.confirm")} value={confirm} onChangeText={(v) => { setConfirm(v); clear("confirm"); }} error={problems.confirm || undefined} secure autoCapitalize="none" autoCorrect={false} autoComplete="new-password" textContentType="newPassword" returnKeyType="go" onSubmitEditing={() => void submit()} />
        <Button label={t("auth.reset.submit")} onPress={() => void submit()} loading={busy} />
        <Button variant="ghost" label={t("auth.reset.askAgain")} onPress={() => navigation.popTo("ForgotPassword")} />
      </FormScroll>
    </Screen>
  );
}
