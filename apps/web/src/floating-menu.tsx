"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BellIcon } from "@phosphor-icons/react/dist/csr/Bell";
import { ListIcon } from "@phosphor-icons/react/dist/csr/List";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { MoonIcon } from "@phosphor-icons/react/dist/csr/Moon";
import { SignInIcon } from "@phosphor-icons/react/dist/csr/SignIn";
import { SunIcon } from "@phosphor-icons/react/dist/csr/Sun";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import type { Identity } from "@rallypoint/domain/contracts";
import { useAuth } from "./auth-context";
import { RingAvatar } from "./badges";
import { useScrollingDown } from "./frame";
import { useAppearance } from "./theme";
import { useApi } from "./use-api";
import { cn, EmptyState, iconButtonClass, Sheet } from "@rallypoint/ui";
// A menu item: a label pill beside a round icon. Hover and keyboard focus
// show on the icon, which is the part that looks like a button.
const fabAction =
  "group/action inline-flex items-center gap-2 border-0 bg-transparent p-0 text-sm font-semibold text-foreground no-underline focus-visible:outline-none [&>span:first-child]:rounded-full [&>span:first-child]:border [&>span:first-child]:border-border [&>span:first-child]:bg-card [&>span:first-child]:px-3 [&>span:first-child]:py-1 [&>span:first-child]:shadow-sm";
const fabIcon = cn(
  iconButtonClass(),
  "group-hover/action:bg-muted group-focus-visible/action:outline-3 group-focus-visible/action:outline-offset-3 group-focus-visible/action:outline-ring",
);
/**
 * Initials of the name people see, which the profile can change. Loaded when
 * the menu opens, so it is never stale; the account name fills in meanwhile.
 */
function MenuAvatar() {
  const { session } = useAuth();
  const identity = useApi<Identity>("/api/me");
  return (
    <RingAvatar
      name={
        identity.data?.displayName ??
        String(
          session?.user.user_metadata.full_name ?? session?.user.email ?? "",
        )
      }
      size="sm"
    />
  );
}

/**
 * The everyday controls, floating in the upper right at every size — the same
 * trigger RallyPoint shares with Trove. The burger unfolds downwards and turns
 * into an X in the same place, so the way out is where the way in was.
 */
export function FloatingMenu({ signedIn }: { signedIn: boolean }) {
  const pathname = usePathname();
  // Remembering where it was opened closes it on navigation without an effect:
  // a new route simply no longer matches.
  const [openAt, setOpenAt] = useState<string | null>(null);
  const expanded = openAt === pathname;
  const [sheet, setSheet] = useState<"updates" | null>(null);
  const { appearance, toggle: toggleAppearance } = useAppearance();
  const trigger = useRef<HTMLButtonElement>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const [scrollingDown, reveal] = useScrollingDown();
  const hidden = scrollingDown && !expanded;
  const collapse = useCallback(() => setOpenAt(null), []);
  // Never strand focus on a chip that is about to unmount, but a tap elsewhere
  // on the page is the reader moving on; pulling focus back would steal it.
  const collapseAndRestoreFocus = useCallback(() => {
    const active = document.activeElement;
    if (
      wrapper.current &&
      active &&
      active !== trigger.current &&
      wrapper.current.contains(active)
    )
      trigger.current?.focus();
    setOpenAt(null);
  }, []);
  useEffect(() => {
    if (!expanded) return;
    function onPointerDown(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        !wrapper.current?.contains(event.target)
      )
        setOpenAt(null);
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", onPointerDown, true);
  }, [expanded]);
  function openSheet(name: "updates") {
    // The sheet is a sibling of the stack, so folding the stack away does not
    // take the dialog down with it; the dialog returns focus to the trigger.
    trigger.current?.focus();
    setOpenAt(null);
    setSheet(name);
  }
  // Names the theme it switches to; the menu folds away like every other item.
  const themeAction = (
    <button
      key="theme"
      type="button"
      className={fabAction}
      onClick={() => {
        toggleAppearance();
        collapseAndRestoreFocus();
      }}
    >
      <span>{appearance === "dark" ? "Light mode" : "Dark mode"}</span>
      <span className={fabIcon} aria-hidden="true">
        {appearance === "dark" ? <SunIcon size={20} /> : <MoonIcon size={20} />}
      </span>
    </button>
  );
  const actions = signedIn
    ? [
        // One search for groups and your own sessions.
        <Link
          key="search"
          className={fabAction}
          href="/search"
          onClick={collapse}
        >
          <span>Search</span>
          <span className={fabIcon} aria-hidden="true">
            <MagnifyingGlassIcon size={20} />
          </span>
        </Link>,
        <button
          key="updates"
          type="button"
          className={fabAction}
          onClick={() => openSheet("updates")}
        >
          <span>Updates</span>
          <span className={fabIcon} aria-hidden="true">
            <BellIcon size={20} />
          </span>
        </button>,
        themeAction,
        // Profile and account are one place: your badges, then sign-in details.
        <Link
          key="profile"
          className={fabAction}
          href="/profile"
          onClick={collapse}
        >
          <span>Profile</span>
          <span
            className={cn(
              fabIcon,
              "overflow-hidden p-0 group-hover/action:bg-transparent group-hover/action:**:data-[slot=avatar-face]:bg-muted",
            )}
            aria-hidden="true"
          >
            <MenuAvatar />
          </span>
        </Link>,
      ]
    : [
        themeAction,
        <Link
          key="sign-in"
          className={fabAction}
          href={`/sign-in?next=${encodeURIComponent(pathname)}`}
          onClick={collapse}
        >
          <span>Sign in</span>
          <span className={fabIcon} aria-hidden="true">
            <SignInIcon size={20} />
          </span>
        </Link>,
      ];
  return (
    <>
      <div
        ref={wrapper}
        className="fixed top-[calc(var(--safe-top)+(var(--spacing-topbar)-var(--spacing-touch))/2)] right-[max(var(--layout-gutter),var(--safe-right))] z-(--layer-float) flex flex-col items-end gap-2 transition-[transform,opacity] duration-200 ease-standard min-[1232px]:right-[calc((100vw-var(--layout-max))/2+var(--layout-gutter))] max-md:top-[calc(var(--safe-top)+12px)] group-data-signed-out/app:max-md:top-[calc(var(--safe-top)+(var(--spacing-topbar)-var(--spacing-touch))/2)] max-md:data-hidden:pointer-events-none max-md:data-hidden:-translate-y-[calc(100%+12px+var(--safe-top))] max-md:data-hidden:opacity-0"
        data-hidden={hidden || undefined}
        onFocusCapture={reveal}
        onKeyDown={(event) => {
          if (event.key !== "Escape" || !expanded) return;
          event.stopPropagation();
          collapseAndRestoreFocus();
        }}
      >
        <button
          ref={trigger}
          type="button"
          className={iconButtonClass()}
          aria-expanded={expanded}
          aria-controls="quick-actions"
          aria-label={expanded ? "Close menu" : "Open menu"}
          onClick={() =>
            expanded ? collapseAndRestoreFocus() : setOpenAt(pathname)
          }
        >
          {/* The icon swaps inside a box that never moves, so the target stays
              put under a finger that is already on it. */}
          <span
            className="inline-flex animate-fab-spin"
            key={expanded ? "close" : "open"}
          >
            {expanded ? <XIcon size={22} /> : <ListIcon size={22} />}
          </span>
        </button>
        {expanded ? (
          <div
            id="quick-actions"
            role="group"
            aria-label="Quick actions"
            className="flex flex-col items-end gap-2"
          >
            {actions.map((action, index) => (
              <div
                key={action.key}
                className="animate-fab-in"
                style={{ animationDelay: `${index * 40}ms` }}
              >
                {action}
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <Sheet
        open={sheet === "updates"}
        onClose={() => setSheet(null)}
        title="Updates"
      >
        <EmptyState
          icon={<BellIcon size={32} />}
          title="Updates are coming"
          action={null}
        >
          Changes to your sessions will collect here in a later release. Until
          then, a session’s own page always shows its latest status.
        </EmptyState>
      </Sheet>
    </>
  );
}
