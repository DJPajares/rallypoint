export const destinations = [
  { key: "home", href: "/home", label: "Home" },
  { key: "sessions", href: "/sessions", label: "Sessions" },
  { key: "groups", href: "/workspace", label: "Groups" },
  { key: "dues", href: "/dues", label: "Dues" },
] as const;
export type Destination = (typeof destinations)[number];
/**
 * Group pages and a session's editor live under Groups, because that is where
 * an organizer reached them from; only the bare /sessions index is Sessions.
 */
export function isActive(pathname: string, href: Destination["href"]) {
  if (href === "/workspace")
    return (
      pathname.startsWith("/workspace") ||
      pathname.startsWith("/groups") ||
      /^\/sessions\/[^/]+\/edit/.test(pathname)
    );
  return pathname === href;
}
