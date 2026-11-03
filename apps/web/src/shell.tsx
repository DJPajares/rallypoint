"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDotsIcon } from "@phosphor-icons/react/dist/csr/CalendarDots";
import { HouseIcon } from "@phosphor-icons/react/dist/csr/House";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { TrophyIcon } from "@phosphor-icons/react/dist/csr/Trophy";
import { UsersThreeIcon } from "@phosphor-icons/react/dist/csr/UsersThree";
import type { Icon } from "@phosphor-icons/react";
import { useAuth } from "./auth-context";
import { CreatePicker } from "./create-picker";
import { FloatingMenu } from "./floating-menu";
import { RankedAlertsProvider } from "./ranked-alerts";
import { FrameContext, useStoredSessionHint } from "./frame";
import { destinations, isActive } from "./navigation";
import type { Destination } from "./navigation";
import { Sheet } from "@rallypoint/ui";
const icons: Record<Destination["key"], Icon> = {
  home: HouseIcon,
  sessions: CalendarDotsIcon,
  groups: UsersThreeIcon,
  ranked: TrophyIcon,
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
    <Link
      href={href}
      className="mr-auto inline-flex items-center gap-2 font-heading text-xl font-bold tracking-tight text-foreground no-underline"
      aria-label="RallyPoint home"
    >
      <span
        className="inline-flex size-brand-mark items-center justify-center rounded-sm bg-brand pb-1 text-2xl leading-none text-brand-foreground"
        aria-hidden="true"
      >
        r<span className="text-brand-orange">.</span>
      </span>
      <span>RallyPoint</span>
    </Link>
  );
}
/**
 * The phone bar's raised create button. Tablet and desktop have none: each
 * page that can add something shows its own button where the action belongs.
 */
function CreateButton({
  href,
  onPick,
}: {
  href: string | null;
  onPick: () => void;
}) {
  const className =
    "absolute top-[calc(var(--spacing-create)/-2)] left-1/2 z-2 inline-flex size-create -translate-x-1/2 items-center justify-center rounded-full border-0 bg-primary text-primary-foreground shadow-lift transition-[background-color,box-shadow,transform] duration-200 ease-standard hover:bg-primary-hover hover:shadow-lift-hover focus-visible:outline-offset-4 active:translate-y-px";
  const content = <PlusIcon size={28} aria-hidden="true" />;
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
      <RankedAlertsProvider enabled={!!session}>
        <div
          className="group/app"
          data-signed-in={signedIn || undefined}
          data-signed-out={!signedIn || undefined}
          data-detail={detailDepth > 0 || undefined}
        >
          <a
            className="fixed top-[calc(12px+var(--safe-top))] left-[calc(12px+var(--safe-left))] z-(--layer-skip) -translate-y-[calc(100%+24px+var(--safe-top))] rounded-full bg-chrome px-4 py-2 font-semibold text-chrome-foreground no-underline transition-transform duration-200 ease-standard focus:translate-y-0"
            href="#main"
          >
            Skip to content
          </a>
          <header className="glass sticky top-0 z-(--layer-bar) border-b border-border pt-(--safe-top) group-data-signed-in/app:max-md:hidden max-md:static max-md:border-b-0 max-md:bg-transparent max-md:backdrop-filter-none">
            <div className="mx-auto flex h-topbar max-w-layout items-center gap-2 pr-[calc(var(--layout-gutter)+var(--spacing-touch)+12px)] pl-(--layout-gutter)">
              <Brand href={signedIn ? "/home" : "/"} />
              {signedIn ? (
                <nav aria-label="Main" className="flex items-center gap-0.5">
                  {destinations.map(({ key, href, label }) => (
                    <Link
                      key={key}
                      href={href}
                      aria-current={
                        isActive(pathname, href) ? "page" : undefined
                      }
                      className="relative inline-flex min-h-touch items-center rounded-full px-3 text-sm font-medium text-muted-foreground no-underline transition-colors duration-150 ease-standard hover:bg-muted hover:text-foreground aria-[current=page]:text-foreground aria-[current=page]:after:absolute aria-[current=page]:after:inset-x-3 aria-[current=page]:after:-bottom-[calc((var(--spacing-topbar)-var(--spacing-touch))/2)] aria-[current=page]:after:h-0.75 aria-[current=page]:after:rounded-t-xs aria-[current=page]:after:bg-chrome md:max-desk:px-2"
                    >
                      {label}
                    </Link>
                  ))}
                </nav>
              ) : null}
            </div>
          </header>
          <FloatingMenu signedIn={signedIn} />
          <main
            id="main"
            className="mx-auto max-w-layout pt-8 pr-[max(var(--layout-gutter),var(--safe-right))] pb-10 pl-[max(var(--layout-gutter),var(--safe-left))] md:max-desk:pt-6 desk:pt-10 desk:pb-12 max-md:pt-[calc(var(--safe-top)+var(--spacing-touch)+16px)] max-md:pb-[calc(var(--layout-bottombar)+var(--safe-bottom)+var(--spacing-create)/2+8px)] group-data-signed-out/app:max-md:pt-3 group-data-detail/app:max-md:pb-[calc(var(--safe-bottom)+112px)]"
          >
            <PageFocus />
            {children}
          </main>
          {signedIn ? (
            <div className="fixed inset-x-0 bottom-0 z-(--layer-bar) hidden h-[calc(var(--layout-bottombar)+var(--safe-bottom))] max-md:block group-data-detail/app:max-md:hidden">
              {/* The bar only sizes and positions. Its surface is a separate
                masked layer, because the mask that carves the notch would
                otherwise carve the create button away with it. The hairline is
                its own layer cut to the same silhouette 1px larger, because a
                border-top can only draw the flat part. */}
              <span className="nav-notch nav-notch-edge" aria-hidden="true" />
              <span
                className="nav-notch nav-notch-surface"
                aria-hidden="true"
              />
              <nav
                aria-label="Main"
                className="relative z-1 mx-auto h-full max-w-bar px-[max(8px,var(--safe-left),var(--safe-right))] pt-2 pb-(--safe-bottom)"
              >
                <ul className="m-0 grid list-none grid-cols-5 gap-1 p-0">
                  {destinations.map(({ key, href, label }, index) => {
                    const Icon = icons[key];
                    const active = isActive(pathname, href);
                    return (
                      <li
                        key={key}
                        className={index === 2 ? "col-start-4" : undefined}
                      >
                        <Link
                          href={href}
                          aria-current={active ? "page" : undefined}
                          className="relative flex min-h-tab flex-col items-center justify-center gap-1 rounded-sm p-1 text-xs font-medium text-muted-foreground no-underline transition-colors duration-200 ease-standard aria-[current=page]:font-semibold aria-[current=page]:text-chrome"
                        >
                          {active ? (
                            <span
                              className="absolute -top-2 left-1/2 -ml-3 h-0.75 w-6 rounded-b-xs bg-chrome"
                              aria-hidden="true"
                            />
                          ) : null}
                          <Icon
                            size={24}
                            weight={active ? "bold" : "regular"}
                            aria-hidden="true"
                          />
                          <span>{label}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </nav>
              <CreateButton href={createHref} onPick={() => setPicking(true)} />
            </div>
          ) : null}
          <Sheet open={picking} onClose={closePicker} title="New session">
            <CreatePicker onNavigate={closePicker} />
          </Sheet>
        </div>
      </RankedAlertsProvider>
    </FrameContext>
  );
}
