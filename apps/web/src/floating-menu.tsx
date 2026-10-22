"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BellIcon } from "@phosphor-icons/react/dist/csr/Bell";
import { CircleHalfIcon } from "@phosphor-icons/react/dist/csr/CircleHalf";
import { ListIcon } from "@phosphor-icons/react/dist/csr/List";
import { MoonIcon } from "@phosphor-icons/react/dist/csr/Moon";
import { SignInIcon } from "@phosphor-icons/react/dist/csr/SignIn";
import { SignOutIcon } from "@phosphor-icons/react/dist/csr/SignOut";
import { SunIcon } from "@phosphor-icons/react/dist/csr/Sun";
import { UserCircleIcon } from "@phosphor-icons/react/dist/csr/UserCircle";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { useAuth } from "./auth-context";
import { useScrollingDown } from "./frame";
import { nextTheme, setThemePreference, useThemePreference } from "./theme";
import { EmptyState, Notice, Sheet } from "./ui";
const themeIcon = {
  system: <CircleHalfIcon size={20} aria-hidden="true" />,
  light: <SunIcon size={20} aria-hidden="true" />,
  dark: <MoonIcon size={20} aria-hidden="true" />,
};
const themeName = { system: "System", light: "Light", dark: "Dark" };
/**
 * The everyday controls, floating in the upper right at every size — the same
 * trigger RallyPoint shares with Trove. The burger unfolds downwards and turns
 * into an X in the same place, so the way out is where the way in was.
 */
export function FloatingMenu({ signedIn }: { signedIn: boolean }) {
  const { session, client } = useAuth();
  const pathname = usePathname();
  // Remembering where it was opened closes it on navigation without an effect:
  // a new route simply no longer matches.
  const [openAt, setOpenAt] = useState<string | null>(null);
  const expanded = openAt === pathname;
  const [sheet, setSheet] = useState<"updates" | "account" | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const theme = useThemePreference();
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
  function openSheet(name: "updates" | "account") {
    // The sheet is a sibling of the stack, so folding the stack away does not
    // take the dialog down with it; the dialog returns focus to the trigger.
    trigger.current?.focus();
    setOpenAt(null);
    setSheet(name);
  }
  async function signOut() {
    setLeaving(true);
    setSignOutError(null);
    const result = await client?.auth.signOut({ scope: "local" });
    if (result?.error) {
      setSignOutError("Sign-out did not finish. Please try again.");
      setLeaving(false);
      return;
    }
    sessionStorage.removeItem("rallypoint.returnTo");
    // Clear protected App Router trees as well as the managed Auth session.
    // A soft redirect can race the signed-out guard on the current private page.
    window.location.replace("/");
  }
  const actions = signedIn
    ? [
        <button
          key="updates"
          type="button"
          className="fab-action"
          onClick={() => openSheet("updates")}
        >
          <span>Updates</span>
          <span className="chip-button" aria-hidden="true">
            <BellIcon size={20} />
          </span>
        </button>,
        <button
          key="theme"
          type="button"
          className="fab-action"
          aria-label={`Theme: ${themeName[theme]}. Switch to ${themeName[nextTheme[theme]]}`}
          onClick={() => setThemePreference(nextTheme[theme])}
        >
          <span>Theme: {themeName[theme]}</span>
          <span className="chip-button" aria-hidden="true">
            {themeIcon[theme]}
          </span>
        </button>,
        <button
          key="account"
          type="button"
          className="fab-action"
          onClick={() => openSheet("account")}
        >
          <span>Account</span>
          <span className="chip-button" aria-hidden="true">
            <UserCircleIcon size={20} />
          </span>
        </button>,
      ]
    : [
        <button
          key="theme"
          type="button"
          className="fab-action"
          aria-label={`Theme: ${themeName[theme]}. Switch to ${themeName[nextTheme[theme]]}`}
          onClick={() => setThemePreference(nextTheme[theme])}
        >
          <span>Theme: {themeName[theme]}</span>
          <span className="chip-button" aria-hidden="true">
            {themeIcon[theme]}
          </span>
        </button>,
        <Link
          key="sign-in"
          className="fab-action"
          href={`/sign-in?next=${encodeURIComponent(pathname)}`}
          onClick={collapse}
        >
          <span>Sign in</span>
          <span className="chip-button" aria-hidden="true">
            <SignInIcon size={20} />
          </span>
        </Link>,
      ];
  return (
    <>
      <div
        ref={wrapper}
        className="fab"
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
          className="chip-button fab-trigger"
          aria-expanded={expanded}
          aria-controls="quick-actions"
          aria-label={expanded ? "Close menu" : "Open menu"}
          onClick={() =>
            expanded ? collapseAndRestoreFocus() : setOpenAt(pathname)
          }
        >
          {/* The icon swaps inside a box that never moves, so the target stays
              put under a finger that is already on it. */}
          <span className="fab-icon" key={expanded ? "close" : "open"}>
            {expanded ? <XIcon size={22} /> : <ListIcon size={22} />}
          </span>
        </button>
        {expanded ? (
          <div
            id="quick-actions"
            role="group"
            aria-label="Quick actions"
            className="fab-stack"
          >
            {actions.map((action, index) => (
              <div
                key={action.key}
                className="fab-item"
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
      <Sheet
        open={sheet === "account"}
        onClose={() => setSheet(null)}
        title="Account"
      >
        <div className="account-sheet">
          <span className="avatar" aria-hidden="true">
            {(session?.user.email ?? "?").slice(0, 1).toUpperCase()}
          </span>
          <p>
            Signed in as
            <br />
            <strong>{session?.user.email ?? "your account"}</strong>
          </p>
        </div>
        {signOutError ? <Notice>{signOutError}</Notice> : null}
        <button
          type="button"
          className="button secondary wide"
          onClick={() => void signOut()}
          disabled={leaving}
        >
          <SignOutIcon size={20} aria-hidden="true" />
          {leaving ? "Signing out…" : "Sign out"}
        </button>
      </Sheet>
    </>
  );
}
