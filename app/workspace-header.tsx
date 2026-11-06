import Link from "next/link";
import { signOut } from "./auth-actions";

const sections = [
  { key: "register", href: "/", label: "Register" },
  { key: "review", href: "/shift-review", label: "Shift review" },
  { key: "approved", href: "/approved", label: "Approved" },
  { key: "imports", href: "/imports", label: "Imports" },
] as const;

export function WorkspaceHeader({ email, canImport, current }: {
  email: string;
  canImport: boolean;
  current: (typeof sections)[number]["key"];
}) {
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link href="/" className="wordmark">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 20 20" fill="none" width="18" height="18">
              <path d="M4 10h3l2.1-4 2.6 8 2-4H16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          Callout Review
        </Link>
        <nav className="workspace-nav" aria-label="Workspace">
          {sections.filter((section) => section.key !== "imports" || canImport).map((section) => (
            <Link key={section.key} href={section.href} className="nav-link" aria-current={section.key === current ? "page" : undefined}>
              {section.label}
            </Link>
          ))}
        </nav>
        <div className="account">
          <span className="account-email" title={email}>{email}</span>
          <form action={signOut}>
            <button type="submit" className="button-secondary">Sign out</button>
          </form>
        </div>
      </div>
    </header>
  );
}
