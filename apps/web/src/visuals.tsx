import type { GroupMember } from "@rallypoint/domain/contracts";
import { cn } from "@rallypoint/ui";

// Shared pictures for groups, people and sessions (owner, 2026-10-30): the
// same crest, faces and date tile on Home, Sessions, Groups and group pages.

/** Six existing avatar gradients; a name or id always lands on the same one. */
const tone = (key: string) => {
  let n = 0;
  for (const ch of key) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
  return (n % 6) + 1;
};
/** The gradient for each tone, as a background image. */
const toneClass = [
  "",
  "bg-(image:--avatar-1)",
  "bg-(image:--avatar-2)",
  "bg-(image:--avatar-3)",
  "bg-(image:--avatar-4)",
  "bg-(image:--avatar-5)",
  "bg-(image:--avatar-6)",
];
const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => [...word][0] ?? "")
    .join("")
    .toUpperCase() || "?";

/**
 * The group's mark: its initials on a gradient chosen by the group. `sm` is
 * the flat 44px version that leads a list row.
 */
export function GroupCrest({
  id,
  name,
  size = "lg",
}: {
  id: string;
  name: string;
  size?: "lg" | "sm";
}) {
  return (
    <span
      className={cn(
        "grid aspect-square place-items-center font-heading font-bold tracking-[0.02em] text-brand-foreground",
        toneClass[tone(id)],
        size === "lg"
          ? "w-21 rounded-xl text-2xl shadow-sm max-[520px]:w-16 max-[520px]:text-xl"
          : "w-11 rounded-md text-base",
      )}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}

export function Face({ name, size }: { name: string; size?: "lg" }) {
  return (
    <span
      data-slot="face"
      className={cn(
        "inline-grid flex-none place-items-center rounded-full font-heading font-bold text-brand-foreground",
        toneClass[tone(name)],
        size === "lg" ? "size-control text-xl" : "size-control-sm text-base",
      )}
      aria-hidden="true"
    >
      {initials(name).slice(0, 1)}
    </span>
  );
}

/** Up to five members' faces, overlapping; the count beside them says the rest. */
export function FaceStack({ members }: { members: GroupMember[] }) {
  return (
    <span
      className="inline-flex *:data-[slot=face]:size-7 *:data-[slot=face]:border-2 *:data-[slot=face]:border-background *:data-[slot=face]:text-xs *:data-[slot=face]:not-first:-ms-2"
      aria-hidden="true"
    >
      {members.slice(0, 5).map((m) => (
        <Face key={m.profileId ?? m.name} name={m.name} />
      ))}
    </span>
  );
}

/**
 * A session's day as a small calendar tile, in its own time zone (D-13).
 * `today` rings it in orange; `hero` is the large orange tile of Up next.
 */
export function DateTile({
  iso,
  timeZone,
  variant = "default",
}: {
  iso: string;
  timeZone: string;
  variant?: "default" | "today" | "hero";
}) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone,
    month: "short",
    day: "numeric",
  }).formatToParts(new Date(iso));
  const part = (type: string) => parts.find((p) => p.type === type)?.value;
  return (
    <span
      className={cn(
        "inline-grid w-11 place-items-center rounded-sm bg-muted py-1 leading-[1.1]",
        variant === "today" &&
          "text-link outline-2 -outline-offset-2 outline-primary",
        variant === "hero" &&
          "w-19 rounded-lg bg-primary py-3 text-primary-foreground max-[520px]:w-16",
      )}
      aria-hidden="true"
    >
      <span
        className={cn(
          "text-xs text-muted-foreground",
          variant === "today" && "text-link",
          variant === "hero" && "text-sm font-semibold text-primary-foreground",
        )}
      >
        {part("month")}
      </span>
      <span
        className={cn(
          "font-heading text-lg font-bold",
          variant === "hero" && "text-2xl",
        )}
      >
        {part("day")}
      </span>
    </span>
  );
}
