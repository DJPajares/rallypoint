"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDotsIcon } from "@phosphor-icons/react/dist/csr/CalendarDots";
import { HouseIcon } from "@phosphor-icons/react/dist/csr/House";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { ReceiptIcon } from "@phosphor-icons/react/dist/csr/Receipt";
import { UsersThreeIcon } from "@phosphor-icons/react/dist/csr/UsersThree";
import type { Icon } from "@phosphor-icons/react";
import { useAuth } from "./auth-context";
import { CreatePicker } from "./create-picker";
import { FloatingMenu } from "./floating-menu";
import { FrameContext, useStoredSessionHint } from "./frame";
import { destinations, isActive } from "./navigation";
import type { Destination } from "./navigation";
import { Sheet } from "./ui";
const icons: Record<Destination["key"], Icon> = {
  home: HouseIcon,
  sessions: CalendarDotsIcon,
  groups: UsersThreeIcon,
  dues: ReceiptIcon,
};
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
function Brand({ href }: { href: string }) {
  return (
    <Link href={href} className="brand" aria-label="RallyPoint home">
      <span className="brand-mark" aria-hidden="true">
        r<span>.</span>
      </span>
      <span className="brand-word">RallyPoint</span>
    </Link>
  );
}
function CreateButton({
  href,
  onPick,
  variant,
}: {
  href: string | null;
  onPick: () => void;
  variant: "top" | "bottom";
}) {
  const className = variant === "top" ? "create-top" : "create-bottom";
  const content =
    variant === "top" ? (
      <>
        <PlusIcon size={20} weight="bold" aria-hidden="true" />
        <span className="create-label">New session</span>
      </>
    ) : (
      <PlusIcon size={28} weight="bold" aria-hidden="true" />
    );
  // Inside a group the button goes straight to that group's form; elsewhere it
  // asks which group first. Same place, same icon, either way.
  return href ? (
    <Link className={className} href={href} aria-label="New session">
      {content}
    </Link>
  ) : (
    <button
      type="button"
      className={className}
      aria-label="New session"
      aria-haspopup="dialog"
      onClick={onPick}
    >
      {content}
    </button>
  );
}
export function Shell({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  const hint = useStoredSessionHint();
  const signedIn = loading ? hint : !!session;
  const pathname = usePathname();
  const [detailDepth, setDetailDepth] = useState(0);
  const [createHref, setCreateHref] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const enterDetail = useCallback(() => {
    setDetailDepth((depth) => depth + 1);
    return () => setDetailDepth((depth) => depth - 1);
  }, []);
  const frame = useMemo(
    () => ({ enterDetail, setCreateHref, openCreate: () => setPicking(true) }),
    [enterDetail],
  );
  const closePicker = useCallback(() => setPicking(false), []);
  return (
    <FrameContext value={frame}>
      <div
        className="app"
        data-signed-in={signedIn || undefined}
        data-detail={detailDepth > 0 || undefined}
      >
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <header className="topbar">
          <div className="topbar-inner">
            <Brand href={signedIn ? "/home" : "/"} />
            {signedIn ? (
              <>
                <nav aria-label="Main" className="topnav">
                  {destinations.map(({ key, href, label }) => {
                    const Icon = icons[key];
                    const active = isActive(pathname, href);
                    return (
                      <Link
                        key={key}
                        href={href}
                        aria-current={active ? "page" : undefined}
                      >
                        <Icon
                          size={20}
                          weight={active ? "fill" : "regular"}
                          aria-hidden="true"
                        />
                        <span>{label}</span>
                      </Link>
                    );
                  })}
                </nav>
                <CreateButton
                  variant="top"
                  href={createHref}
                  onPick={() => setPicking(true)}
                />
              </>
            ) : null}
          </div>
        </header>
        <FloatingMenu signedIn={signedIn} />
        <main id="main">
          <PageFocus />
          {children}
        </main>
        {signedIn ? (
          <div className="bottombar">
            <nav aria-label="Main">
              <ul>
                {destinations.map(({ key, href, label }, index) => {
                  const Icon = icons[key];
                  const active = isActive(pathname, href);
                  return (
                    <li key={key} className={index > 1 ? "after-create" : ""}>
                      <Link
                        href={href}
                        aria-current={active ? "page" : undefined}
                      >
                        <Icon
                          size={24}
                          weight={active ? "fill" : "regular"}
                          aria-hidden="true"
                        />
                        <span>{label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>
            <CreateButton
              variant="bottom"
              href={createHref}
              onPick={() => setPicking(true)}
            />
          </div>
        ) : null}
        <Sheet open={picking} onClose={closePicker} title="New session">
          <CreatePicker onNavigate={closePicker} />
        </Sheet>
      </div>
    </FrameContext>
  );
}
