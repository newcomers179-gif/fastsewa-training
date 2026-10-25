import { useNavigation } from "@react-navigation/native";
import React, { useRef, useState } from "react";
import { TextInput } from "react-native";
import { useTranslation } from "react-i18next";
import { ThemedText } from "@/components/ThemedText";
import { Banner, Button, FormScroll, Screen, TextField } from "@/components/ui";
import { useAuth, useUser } from "@/hooks/useAuth";
import { errorMessage, fieldErrors, isFieldError } from "@/lib/errors";
import { onlyProblems, validateConfirmation, validateNewPassword, validateRequired } from "@/lib/validation";

/** Also the "ForcedPassword" screen: when an administrator issued a one-time password, nothing else works until it is replaced. */
export default function ChangePasswordScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const user = useUser();
  const { changePassword, logout } = useAuth();
  const forced = user.mustChangePassword;
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const nextRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);

  const clear = (field: string) => setProblems((p) => ({ ...p, [field]: "" }));

  const submit = async () => {
    const found = onlyProblems({
      currentPassword: validateRequired(current),
      newPassword: validateNewPassword(next, { username: user.username, staff: user.role !== "worker" }) ?? (next === current ? "validation.passwordSame" : null),
      confirm: validateConfirmation(next, confirm),
    });
    const translated = Object.fromEntries(Object.entries(found).map(([field, key]) => [field, t(key)]));
    setProblems(translated);
    if (Object.keys(translated).length > 0) return;
    setBusy(true);
    setError(null);
    try {
      await changePassword(current, next);
      // Forced: the navigator now swaps this screen for the app. Otherwise say it worked.
      setDone(true);
    } catch (e) {
      const fields = fieldErrors(e, t);
      if (fields.password) fields.newPassword = fields.password;
      setProblems(fields);
      setError(isFieldError(e) ? null : e);
    } finally {
      setBusy(false);
    }
  };

  if (done && !forced) {
    return (
      <Screen edges={["bottom", "left", "right"]}>
        <FormScroll>
          <Banner tone="success">{t("auth.change.done")}</Banner>
          <Button label={t("common.ok")} onPress={() => navigation.goBack()} />
        </FormScroll>
      </Screen>
    );
  }

  return (
    <Screen edges={["bottom", "left", "right"]}>
      <FormScroll>
        {forced ? <Banner tone="warning">{t("auth.change.forcedIntro")}</Banner> : <ThemedText>{t("auth.change.intro")}</ThemedText>}
        {error ? <Banner tone="error">{errorMessage(error, t)}</Banner> : null}
        <TextField label={forced ? t("auth.change.currentForced") : t("auth.change.current")} value={current} onChangeText={(v) => { setCurrent(v); clear("currentPassword"); }} error={problems.currentPassword || undefined} secure autoCapitalize="none" autoCorrect={false} autoComplete="current-password" textContentType="password" returnKeyType="next" onSubmitEditing={() => nextRef.current?.focus()} />
        <TextField ref={nextRef} label={t("auth.change.new")} hint={user.role === "worker" ? t("auth.register.passwordHint") : t("auth.change.staffHint")} value={next} onChangeText={(v) => { setNext(v); clear("newPassword"); }} error={problems.newPassword || undefined} secure autoCapitalize="none" autoCorrect={false} autoComplete="new-password" textContentType="newPassword" returnKeyType="next" onSubmitEditing={() => confirmRef.current?.focus()} />
        <TextField ref={confirmRef} label={t("auth.change.confirm")} value={confirm} onChangeText={(v) => { setConfirm(v); clear("confirm"); }} error={problems.confirm || undefined} secure autoCapitalize="none" autoCorrect={false} autoComplete="new-password" textContentType="newPassword" returnKeyType="go" onSubmitEditing={() => void submit()} />
        <Button label={t("auth.change.submit")} onPress={() => void submit()} loading={busy} />
        {forced ? <Button variant="ghost" label={t("profile.logout")} onPress={() => void logout()} /> : null}
      </FormScroll>
    </Screen>
  );
}
