"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
interface Frame {
  enterDetail: () => () => void;
  setCreateHref: (href: string | null) => void;
  openCreate: () => void;
}
export const FrameContext = createContext<Frame>({
  enterDetail: () => () => {},
  setCreateHref: () => {},
  openCreate: () => {},
});
/**
 * A detail page (a session, a form, a group) owns the bottom of a phone screen:
 * the tab bar gives way to its back chip and sticky actions while it is mounted.
 */
export function useDetailChrome() {
  const { enterDetail } = useContext(FrameContext);
  useEffect(() => enterDetail(), [enterDetail]);
}
export const useFrame = () => useContext(FrameContext);
/** Inside a group, the create button skips the picker and opens that group's form. */
export function useCreateTarget(href: string | null) {
  const { setCreateHref } = useContext(FrameContext);
  useEffect(() => {
    setCreateHref(href);
    return () => setCreateHref(null);
  }, [href, setCreateHref]);
}
const phoneQuery = "(max-width: 767px)";
export function useIsPhone() {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(phoneQuery);
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => window.matchMedia(phoneQuery).matches,
    () => false,
  );
}
/**
 * Supabase keeps the session under this key. Reading it synchronously lets the
 * frame draw signed-in chrome on first paint instead of after the auth check,
 * so the tab bar does not pop in on every launch. The auth check still decides.
 */
export function useStoredSessionHint() {
  return useSyncExternalStore(
    () => () => {},
    () => {
      try {
        return !!localStorage.getItem("rallypoint.auth");
      } catch {
        return false;
      }
    },
    () => false,
  );
}
/** True while the reader is scrolling down past the top; false on the way back up. */
export function useScrollingDown() {
  const [down, setDown] = useState(false);
  useEffect(() => {
    let last = window.scrollY;
    function onScroll() {
      const y = window.scrollY;
      if (Math.abs(y - last) < 8) return;
      setDown(y > last && y > 80);
      last = y;
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return [down, () => setDown(false)] as const;
}
