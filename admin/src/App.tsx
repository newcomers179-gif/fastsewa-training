import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChangePasswordForm, ForcedPasswordScreen, BrandMark, SessionProvider, SignInScreen, useSession } from "./session";
import { useRoute } from "./router";
import { Button, ConfirmProvider, EmptyState, Icon, Loading, Modal, ToastProvider, useToast, type IconName } from "./ui";
import { Dashboard } from "./pages/Dashboard";
import { Learners } from "./pages/Learners";
import { LearnerDetail } from "./pages/LearnerDetail";
import { Courses } from "./pages/Courses";
import { CourseEditor } from "./pages/CourseEditor";
import { Certificates } from "./pages/Certificates";
import { Staff } from "./pages/Staff";
import { Audit } from "./pages/Audit";
import { Broadcast } from "./pages/Broadcast";

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  match: string;
  adminOnly?: boolean;
}

const MAIN_NAV: NavItem[] = [
  { to: "/", label: "Dashboard", icon: "dashboard", match: "" },
  { to: "/learners", label: "Learners", icon: "users", match: "learners" },
  { to: "/courses", label: "Courses", icon: "book", match: "courses" },
  { to: "/certificates", label: "Certificates", icon: "award", match: "certificates" },
];
const ADMIN_NAV: NavItem[] = [
  { to: "/staff", label: "Staff accounts", icon: "shield", match: "staff", adminOnly: true },
  { to: "/broadcast", label: "Notifications", icon: "megaphone", match: "broadcast", adminOnly: true },
  { to: "/audit", label: "Audit log", icon: "clock", match: "audit", adminOnly: true },
];

function AdminOnly({ children }: { children: ReactNode }) {
  const { isAdmin } = useSession();
  if (isAdmin) return <>{children}</>;
  return <EmptyState title="Administrators only">This page is not available to trainer accounts.</EmptyState>;
}

function Screen() {
  const { segments } = useRoute();
  const [section, id] = segments;
  switch (section) {
    case undefined:
      return <Dashboard />;
    case "learners":
      return id ? <LearnerDetail id={id} /> : <Learners />;
    case "courses":
      return id ? <CourseEditor id={id} /> : <Courses />;
    case "certificates":
      return <Certificates />;
    case "staff":
      return (
        <AdminOnly>
          <Staff />
        </AdminOnly>
      );
    case "broadcast":
      return (
        <AdminOnly>
          <Broadcast />
        </AdminOnly>
      );
    case "audit":
      return (
        <AdminOnly>
          <Audit />
        </AdminOnly>
      );
    default:
      return (
        <EmptyState title="Page not found" action={<a className="btn btn-secondary" href="#/">Go to the dashboard</a>}>
          That address does not exist in the console.
        </EmptyState>
      );
  }
}

function Shell() {
  const { user, isAdmin, signOut } = useSession();
  const { segments } = useRoute();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [passwordDialog, setPasswordDialog] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const section = segments[0] ?? "";
  const pageKey = segments.join("/");

  // Each page change starts at the top, and screen readers land on the new page.
  useEffect(() => {
    setOpen(false);
    window.scrollTo(0, 0);
    mainRef.current?.focus({ preventScroll: true });
  }, [pageKey]);

  const link = (item: NavItem) => (
    <a key={item.to} href={`#${item.to}`} aria-current={section === item.match ? "page" : undefined}>
      <Icon name={item.icon} />
      {item.label}
    </a>
  );

  return (
    <div className="shell">
      <aside className={`rail${open ? " open" : ""}`}>
        <a className="brand" href="#/">
          <BrandMark />
          <span className="brand-name">
            FastSewa
            <span className="brand-sub">Staff console</span>
          </span>
        </a>
        <button type="button" className="btn btn-quiet btn-icon menu-toggle" aria-label="Menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          <Icon name={open ? "x" : "menu"} />
        </button>
        <nav className="nav" aria-label="Main">
          {MAIN_NAV.map(link)}
          {isAdmin ? (
            <>
              <span className="nav-group">Administration</span>
              {ADMIN_NAV.map(link)}
            </>
          ) : null}
        </nav>
        <div className="rail-user">
          <div>
            <strong title={user?.displayName}>{user?.displayName}</strong>
            <span className="role">{isAdmin ? "Administrator" : "Trainer"}</span>
          </div>
          <Button tone="quiet" small icon="key" onClick={() => setPasswordDialog(true)}>
            Change password
          </Button>
          <Button tone="quiet" small icon="logout" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </aside>
      <main className="main" ref={mainRef} tabIndex={-1} id="main">
        <div className="main-inner">
          <Screen />
        </div>
      </main>
      {passwordDialog ? (
        <Modal title="Change password" onClose={() => setPasswordDialog(false)}>
          <ChangePasswordForm
            onDone={() => {
              setPasswordDialog(false);
              toast("Password changed. Other devices were signed out.");
            }}
          />
        </Modal>
      ) : null}
    </div>
  );
}

function Gate() {
  const { status } = useSession();
  if (status === "loading") {
    return (
      <div className="signin-main fill-screen">
        <Loading label="Checking your session…" />
      </div>
    );
  }
  if (status === "signedOut") return <SignInScreen />;
  if (status === "mustChangePassword") return <ForcedPasswordScreen />;
  return <Shell />;
}

export function App() {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <SessionProvider>
          <Gate />
        </SessionProvider>
      </ConfirmProvider>
    </ToastProvider>
  );
}
