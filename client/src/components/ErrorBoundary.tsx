import React from "react";
import { useTranslation } from "react-i18next";
import { Button, EmptyView, Screen } from "@/components/ui";
import { reportError } from "@/lib/report";

/** If a screen crashes, show a calm message and a way to continue instead of a blank or frozen app. */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    reportError(error, { componentStack: info.componentStack });
  }

  render() {
    return this.state.failed ? <Fallback onRetry={() => this.setState({ failed: false })} /> : this.props.children;
  }
}

function Fallback({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <Screen>
      <EmptyView icon="alert-triangle" title={t("boundary.title")} body={t("boundary.body")} />
      <Button label={t("boundary.retry")} onPress={onRetry} style={{ marginHorizontal: 24 }} />
    </Screen>
  );
}
