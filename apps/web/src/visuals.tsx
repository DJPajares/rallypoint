import type { GroupMember } from "@rallypoint/domain/contracts";

// Shared pictures for groups, people and sessions (owner, 2026-10-30): the
// same crest, faces and date tile on Home, Sessions, Groups and group pages.

/** Six existing avatar gradients; a name or id always lands on the same one. */
const tone = (key: string) => {
  let n = 0;
  for (const ch of key) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
  return (n % 6) + 1;
};
const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => [...word][0] ?? "")
    .join("")
    .toUpperCase() || "?";

/** The group's mark: its initials on a gradient chosen by the group. */
export function GroupCrest({ id, name }: { id: string; name: string }) {
  return (
    <span className="group-crest" data-tone={tone(id)} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

export function Face({ name, size }: { name: string; size?: "lg" }) {
  return (
    <span
      className={size === "lg" ? "group-face group-face--lg" : "group-face"}
      data-tone={tone(name)}
      aria-hidden="true"
    >
      {initials(name).slice(0, 1)}
    </span>
  );
}

/** Up to five members' faces, overlapping; the count beside them says the rest. */
export function FaceStack({ members }: { members: GroupMember[] }) {
  return (
    <span className="group-faces" aria-hidden="true">
      {members.slice(0, 5).map((m) => (
        <Face key={m.profileId ?? m.name} name={m.name} />
      ))}
    </span>
  );
}

/** A session's day as a small calendar tile, in its own time zone (D-13). */
export function DateTile({ iso, timeZone }: { iso: string; timeZone: string }) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone,
    month: "short",
    day: "numeric",
  }).formatToParts(new Date(iso));
  const part = (type: string) => parts.find((p) => p.type === type)?.value;
  return (
    <span className="group-date" aria-hidden="true">
      <span className="group-date__month">{part("month")}</span>
      <span className="group-date__day">{part("day")}</span>
    </span>
  );
}

