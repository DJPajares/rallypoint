"use client";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRightIcon } from "@phosphor-icons/react/dist/csr/ArrowRight";
import { HouseIcon } from "@phosphor-icons/react/dist/csr/House";
import { SignOutIcon } from "@phosphor-icons/react/dist/csr/SignOut";
import { UsersThreeIcon } from "@phosphor-icons/react/dist/csr/UsersThree";
import { useAuth } from "./auth-context";
import { Notice } from "./ui";
function PageFocus() {
  const pathname = usePathname();
  useEffect(() => {
    function focusHeading() {
      const title = document.querySelector<HTMLElement>("main h1");
      const text = title?.innerText.replace(/\s+/g, " ").trim();
      if (!title || !text) return false;
      title.tabIndex = -1;
      title.focus({ preventScroll: true });
      document.title = `${text} · RallyPoint`;
      return true;
    }
    if (focusHeading()) return;
    const main = document.getElementById("main");
    if (!main) return;
    // A route's Suspense boundary may reveal its heading after this effect runs.
    const observer = new MutationObserver(() => {
      if (focusHeading()) observer.disconnect();
    });
    observer.observe(main, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [pathname]);
  return null;
}
export function Shell({ children }: { children: ReactNode }) {
  const { session, client } = useAuth();
  const pathname = usePathname();
  const [error, setError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  async function signOut() {
    setLeaving(true);
    setError(null);
    const result = await client?.auth.signOut({ scope: "local" });
    if (result?.error) {
      setError("Sign-out did not finish. Please try again.");
      setLeaving(false);
      return;
    }
    sessionStorage.removeItem("rallypoint.returnTo");
    // Clear protected App Router trees as well as the managed Auth session.
    // A soft redirect can race the signed-out guard on the current private page.
    window.location.replace("/");
  }
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="sidebar">
        <Link href="/" className="brand" aria-label="RallyPoint home">
          <span className="brand-mark">
            r<span>.</span>
          </span>
          <span>RallyPoint</span>
        </Link>
        <nav aria-label="Main navigation">
          <Link href="/" aria-current={pathname === "/" ? "page" : undefined}>
            <HouseIcon size={21} />
            Home
          </Link>
          <Link
            href="/workspace"
            aria-current={
              pathname.startsWith("/workspace") ||
              pathname.startsWith("/groups")
                ? "page"
                : undefined
            }
          >
            <UsersThreeIcon size={21} />
            Your groups
          </Link>
        </nav>
        <div className="sidebar-note">
          <span>↗</span>
          <p>
            Fill the spots,
            <br />
            not the chat.
          </p>
        </div>
        <div className="account-control">
          {session ? (
            <button onClick={() => void signOut()} disabled={leaving}>
              <SignOutIcon size={20} />
              {leaving ? "Signing out…" : "Sign out"}
            </button>
          ) : (
            <Link href="/sign-in">
              <ArrowRightIcon size={20} />
              Sign in
            </Link>
          )}
        </div>
      </aside>
      <div className="content-shell">
        <header className="topbar">
          <span>Good plans. Better company.</span>
          <span>RallyPoint</span>
        </header>
        <main id="main">
          {error ? <Notice>{error}</Notice> : null}
          <PageFocus />
          {children}
        </main>
        <footer>
          <span>Made for getting together.</span>
          <span>One group. One shared link.</span>
        </footer>
      </div>
    </div>
  );
}
