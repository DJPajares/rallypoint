"use client";
import { BadgesSkeleton, ProfileSkeleton } from "./skeletons";
import { useEffect, useId, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/csr/PencilSimple";
import { SignOutIcon } from "@phosphor-icons/react/dist/csr/SignOut";
import { MedalIcon } from "@phosphor-icons/react/dist/csr/Medal";
import {
  badgeAbout,
  badgeCatalog,
  badgeDefinition,
  badgeOrEmpty,
  badgeStates,
  firstStep,
  levelColors,
  levelLabel as badgeLevelLabel,
  levelOf,
  levelSentence,
  levelTarget,
  levelTitle,
  medallionLabel,
  newestUnseen,
  nextBadge,
  nextTarget,
  progressLabel,
  rosterTitle,
  unseenIds,
} from "@rallypoint/domain/badges";
import type {
  BadgeGlyph,
  BadgeKey,
  BadgeState,
  BadgesView,
  Level,
  RosterTitle,
} from "@rallypoint/domain/badges";
import type { Identity } from "@rallypoint/domain/contracts";
import { levelLabel, levelStep } from "@rallypoint/domain/profile";
import {
  calibratingCategories,
  calibratingLabel,
  calibratingSpoken,
  formatName,
  rankLabel,
  rankSpoken,
  rankedCategories,
} from "@rallypoint/domain/ranked";
import type {
  MyProfile,
  ProfileActivity,
  PublicProfile,
} from "@rallypoint/domain/profile";
import {
  ActivityIcon,
  buttonClass,
  iconButtonClass,
  cx,
  EmptyState,
  Notice,
  Sheet,
  StatRow,
  SwitchField,
} from "@rallypoint/ui";
import { useAuth } from "./auth-context";
import { useApi } from "./use-api";
import { useActivities } from "./use-activities";
import { useSignOut } from "./sign-out";
import { ShareButton } from "./share-button";

// Medallions are drawn, not loaded: one gradient disc, a thin inner ring, a
// glint and a single glyph (PRD D-15). The glyph is the badge; the colour, the
// rim and the numeral chip are the level (P-19). Not started is a dashed outline.
function Glyph({ glyph }: { glyph: BadgeGlyph }) {
  const line = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 5,
    strokeLinecap: "round",
    strokeLinejoin: "round",
  } as const;
  switch (glyph) {
    case "rally":
      return (
        <>
          <path d="M25 71 Q37 38 56 36" {...line} strokeDasharray="0 9" />
          <circle cx="67" cy="40" r="11" {...line} />
          <circle cx="64" cy="37" r="2.2" fill="currentColor" />
          <circle cx="71" cy="41" r="2.2" fill="currentColor" />
          <circle cx="65" cy="45" r="2.2" fill="currentColor" />
        </>
      );
    case "calendar":
      return (
        <>
          <rect x="29" y="32" width="42" height="39" rx="8" {...line} />
          <path d="M29 45 H71 M40 26 V36 M60 26 V36" {...line} />
          <path d="M40 58 L47 64 L61 51" {...line} />
        </>
      );
    case "plus":
      return (
        <>
          <circle cx="41" cy="41" r="8.5" {...line} />
          <path d="M24 71 C26 59 33 54 41 54 C49 54 56 59 58 71" {...line} />
          <path d="M66 31 V45 M59 38 H73" {...line} />
          <path d="M61 56 C67 57 73 62 75 71" {...line} />
        </>
      );
    case "faces":
      return (
        <>
          <circle cx="32" cy="45" r="6.5" {...line} />
          <circle cx="50" cy="39" r="7.5" {...line} />
          <circle cx="68" cy="45" r="6.5" {...line} />
          <path d="M22 70 C23 62 27 58 32 58" {...line} />
          <path d="M37 70 C38 60 43 55 50 55 C57 55 62 60 63 70" {...line} />
          <path d="M78 70 C77 62 73 58 68 58" {...line} />
        </>
      );
    case "host":
      return (
        <>
          <path d="M37 26 V75" {...line} />
          <path
            d="M37 29 H66 L58 40 L66 51 H37 Z"
            fill="currentColor"
            stroke="currentColor"
            strokeWidth={4}
            strokeLinejoin="round"
          />
        </>
      );
    case "full":
      return (
        <g fill="currentColor">
          {[36, 50, 64].flatMap((y) =>
            [36, 50, 64].map((x) => (
              <circle key={`${x}-${y}`} cx={x} cy={y} r="6" />
            )),
          )}
        </g>
      );
    case "compass":
      return (
        <>
          <circle cx="50" cy="50" r="24" {...line} />
          <path d="M50 33 L57 50 L50 67 L43 50 Z" {...line} strokeWidth={4} />
          <path d="M50 33 L57 50 H43 Z" fill="currentColor" />
        </>
      );
    case "split":
      return (
        <>
          <path d="M50 25 L75 50 L50 75 L25 50 Z" {...line} />
          <path
            d="M50 25 L25 50 L50 75 Z"
            fill="currentColor"
            stroke="currentColor"
            strokeWidth={5}
            strokeLinejoin="round"
          />
        </>
      );
    case "rings":
      return (
        <>
          <circle cx="39" cy="50" r="15" {...line} />
          <circle cx="61" cy="50" r="15" {...line} />
        </>
      );
    case "door":
      return (
        <>
          <path d="M24 74 H76 M38 74 V27 H64 V74" {...line} />
          <path
            d="M38 27 L55 33 V70 L38 74 Z"
            fill="currentColor"
            stroke="currentColor"
            strokeWidth={4}
            strokeLinejoin="round"
          />
        </>
      );
  }
}

export function Medallion({
  badge,
  level,
  size,
  decorative = false,
}: {
  badge: BadgeKey;
  /** 0 is not started: a dashed outline. */
  level: 0 | Level;
  size: number;
  /** Hide from assistive tech when a visible label already names it. */
  decorative?: boolean;
}) {
  const definition = badgeDefinition(badge);
  const gradient = `medal-${useId().replace(/[^\w-]/g, "")}`;
  const colors = level ? levelColors[level - 1] : null;
  return (
    <svg
      data-slot="medallion"
      className={cx("block flex-none", !colors && "text-input")}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      {...(decorative
        ? { "aria-hidden": true }
        : { role: "img", "aria-label": medallionLabel(badge, level) })}
    >
      {colors ? (
        <>
          <defs>
            <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor={colors[0]} />
              <stop offset="1" stopColor={colors[1]} />
            </linearGradient>
          </defs>
          <circle cx="50" cy="50" r="47" fill={`url(#${gradient})`} />
          {/* The rim firms up at level 3 and doubles at level 5; nothing else escalates. */}
          <circle
            cx="50"
            cy="50"
            r="38.5"
            fill="none"
            stroke="var(--badge-shine)"
            strokeOpacity=".38"
            strokeWidth={level >= 3 ? 2.6 : 1.6}
          />
          {level === 5 ? (
            <circle
              cx="50"
              cy="50"
              r="43"
              fill="none"
              stroke="var(--badge-shine)"
              strokeOpacity=".5"
              strokeWidth="1.2"
            />
          ) : null}
          <path
            d="M17 44 A34 34 0 0 1 56 15"
            fill="none"
            stroke="var(--badge-shine)"
            strokeOpacity=".4"
            strokeWidth="5"
            strokeLinecap="round"
          />
        </>
      ) : (
        <circle
          cx="50"
          cy="50"
          r="45"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeDasharray="5 6"
        />
      )}
      <g style={{ color: colors ? "var(--badge-ink-light)" : "inherit" }}>
        <Glyph glyph={definition.glyph} />
      </g>
      {/* The level without colour; too small to read under 32px, where text says it. */}
      {colors && size >= 32 ? (
        <g aria-hidden="true">
          <circle
            cx="81"
            cy="81"
            r="13"
            fill="var(--badge-shine)"
            stroke={colors[1]}
            strokeWidth="3"
          />
          <text
            x="81"
            y="86.5"
            textAnchor="middle"
            fontFamily="var(--font-heading)"
            fontWeight="800"
            fontSize="16"
            fill={colors[1]}
          >
            {level}
          </text>
        </g>
      ) : null}
    </svg>
  );
}

/** An account holder's name; opens their public profile once they have one. */
export function PersonName({
  name,
  profileId,
}: {
  name: string;
  profileId?: string | null;
}) {
  return profileId ? (
    <Link
      data-slot="person-link"
      className="text-inherit underline decoration-muted-foreground underline-offset-2 hover:decoration-current focus-visible:rounded-sm focus-visible:shadow-focus focus-visible:outline-none"
      href={`/people/${profileId}`}
    >
      {name}
    </Link>
  ) : (
    <>{name}</>
  );
}

/**
 * The badge a person shows, as its current level title (WDL-405). Anything
 * that isn't a badge at a level, such as an old-style title mid-rollout,
 * shows nothing.
 */
export function TitlePill({ title }: { title: unknown }) {
  const shown = rosterTitle(title);
  if (!shown) return null;
  return (
    <span
      data-slot="title-pill"
      className="ml-2 inline-flex max-w-full items-center gap-1 truncate rounded-full border border-border bg-muted py-0.5 pr-2 pl-0.5 align-middle text-xs leading-[1.6] font-semibold whitespace-nowrap text-foreground"
    >
      <Medallion badge={shown.key} level={shown.level} size={18} decorative />
      {levelTitle(shown.key, shown.level)}
    </span>
  );
}

/**
 * A person's medals (D-26), e.g. "Veteran ★★★ · Doubles", one pill each.
 * Read aloud as "Doubles: Veteran, 3 of 5 stars"; the icon only decorates.
 * Anything unrecognised shows nothing.
 */
export function RankPills({ ranks }: { ranks: unknown }) {
  return rankedCategories(ranks).map((c) => (
    <span
      key={`${c.activity}:${c.format}`}
      data-slot="rank-pill"
      className="ml-2 inline-flex max-w-full items-center gap-1 truncate rounded-full border border-border bg-muted px-2 py-0.5 align-middle text-xs leading-[1.6] font-semibold whitespace-nowrap text-foreground"
    >
      <MedalIcon size={14} weight="fill" aria-hidden="true" />
      <span aria-hidden="true">{rankLabel(c)}</span>
      <span className="sr-only">{rankSpoken(c)}</span>
    </span>
  ));
}

/**
 * Ranked play, in a card of its own under Plays (D-26): each activity with
 * its medals. Kept apart from the self-rated levels, which ranked results
 * never change. Only the owner's read carries calibration progress, so
 * visitors see nothing until a first medal.
 */
function Ranked({ ranks }: { ranks: unknown }) {
  const { catalog } = useActivities();
  const medals = rankedCategories(ranks);
  const calibrating = calibratingCategories(ranks);
  const activities = [
    ...new Set([...medals, ...calibrating].map((c) => c.activity)),
  ];
  if (!activities.length) return null;
  return (
    <section aria-labelledby="ranked-title">
      <h2 id="ranked-title" className="mt-8 mb-3">
        Ranked
      </h2>
      <ul className="m-0 list-none overflow-hidden rounded-lg bg-card p-0 shadow-sm">
        {activities.map((key) => {
          const activity = catalog?.find((c) => c.key === key);
          return (
            <li
              key={key}
              className="flex min-h-15 items-center gap-3 border-t border-border py-2 pr-4 pl-3 first:border-t-0"
            >
              <span
                className="inline-flex size-10 flex-none items-center justify-center rounded-full bg-success text-success-foreground"
                aria-hidden="true"
              >
                <ActivityIcon icon={activity?.icon ?? key} size={22} />
              </span>
              <span className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-3 gap-y-1 [&_[data-slot=rank-pill]]:ml-0">
                <span className="min-w-0 font-semibold wrap-anywhere">
                  {activity?.name ?? key}
                </span>
                <span className="inline-flex flex-wrap gap-1.5">
                  <RankPills ranks={medals.filter((c) => c.activity === key)} />
                  {calibrating
                    .filter((c) => c.activity === key)
                    .map((c) => (
                      <span
                        key={c.format}
                        data-slot="calibrating-pill"
                        className="inline-flex items-center rounded-full border border-dashed border-border px-2 py-0.5 text-xs leading-[1.6] font-semibold whitespace-nowrap text-muted-foreground"
                      >
                        <span aria-hidden="true">
                          {formatName(c.format)} · {calibratingLabel(c)}
                        </span>
                        <span className="sr-only">{calibratingSpoken(c)}</span>
                      </span>
                    ))}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function useBadgeWrites() {
  const { session } = useAuth();
  return async (path: string, body: Record<string, unknown>) => {
    const response = await fetch(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session?.access_token}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    const result = await response.json();
    if (!response.ok)
      throw new Error(result.error?.message ?? "Please try again.");
    return result as BadgesView;
  };
}

/**
 * A new level gets one moment: shown once, then every new level is marked seen
 * whichever way the sheet is closed. Nothing is pushed or emailed (PRD D-16).
 */
export function EarnedBadgeSheet({ view }: { view: BadgesView | null }) {
  const write = useBadgeWrites();
  const [closed, setClosed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shown = rosterTitle(view?.title);
  // The badge you show goes first, so a change to your title is never folded away.
  const moment = newestUnseen(badgeStates(view), shown?.key);
  if (!view || !moment) return null;
  const unseen = unseenIds(badgeStates(view));
  const { key, level, more } = moment;
  const title = levelTitle(key, level);
  const isShown = shown?.key === key;
  function close() {
    setClosed(true);
    // If this fails the level simply shows again next time; nothing is lost.
    write("/api/me/badges/seen", { ids: unseen.slice(0, 50) }).catch(() => {});
  }
  async function showAsTitle(id: string) {
    setBusy(true);
    setError(null);
    try {
      await write("/api/me/title", { badgeId: id });
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet open={!closed} onClose={close} title="New badge">
      <div className="grid justify-items-center gap-2 text-center">
        <div className="grid h-43 w-50 place-items-center bg-[radial-gradient(circle_at_50%_52%,color-mix(in_srgb,var(--badge-glow)_30%,transparent)_0%,color-mix(in_srgb,var(--badge-glow)_10%,transparent)_38%,transparent_64%)] **:data-[slot=medallion]:animate-medallion-in **:data-[slot=medallion]:drop-shadow-[0_14px_18px_var(--badge-glow-shadow)]">
          <Medallion badge={key} level={level} size={132} />
        </div>
        <p className="m-0 font-heading text-2xl leading-tight font-extrabold tracking-tight">
          {badgeDefinition(key).name} · Level {level}
        </p>
        <p className={earnedLine}>{levelSentence(key, level)}</p>
        {isShown ? (
          <p className={earnedLine}>Your title is now {title}.</p>
        ) : null}
        {more ? (
          <Link className="text-sm text-link" href="/profile" onClick={close}>
            +{more} more on your profile
          </Link>
        ) : null}
        {error ? <Notice>{error}</Notice> : null}
        {!isShown ? (
          <button
            type="button"
            className={cx(
              buttonClass({ variant: "primary", wide: true }),
              "mt-4",
            )}
            disabled={busy}
            onClick={() => showAsTitle(key)}
          >
            {busy ? "Saving…" : `Show “${title}” as my title`}
          </button>
        ) : null}
        <button
          type="button"
          className={buttonClass({
            variant: isShown ? "primary" : "link",
            wide: true,
          })}
          disabled={busy}
          onClick={close}
        >
          Done
        </button>
      </div>
    </Sheet>
  );
}

/** For pages that do not otherwise load badges, such as a session page. */
export function EarnedBadgeCheck() {
  const { session } = useAuth();
  return session ? <SignedInBadgeCheck /> : null;
}
function SignedInBadgeCheck() {
  const badges = useApi<BadgesView>("/api/me/badges");
  return <EarnedBadgeSheet view={badges.data} />;
}

function Ring({ value, children }: { value: number; children: ReactNode }) {
  const circumference = 2 * Math.PI * 19;
  return (
    <span
      className="relative size-11 flex-none *:data-[slot=medallion]:absolute *:data-[slot=medallion]:inset-2.25 [&>svg]:absolute [&>svg]:inset-0"
      aria-hidden="true"
    >
      <svg viewBox="0 0 44 44" width="44" height="44">
        <circle
          className="fill-none stroke-border stroke-4"
          cx="22"
          cy="22"
          r="19"
        />
        <circle
          className="fill-none stroke-chrome stroke-4 [stroke-linecap:round]"
          cx="22"
          cy="22"
          r="19"
          strokeDasharray={`${circumference * value} ${circumference}`}
          transform="rotate(-90 22 22)"
        />
      </svg>
      {children}
    </span>
  );
}

/** One quiet nudge toward the closest next level; nothing when none is under way. */
export function NextBadge({ view }: { view: BadgesView | null }) {
  const next = nextBadge(badgeStates(view));
  if (!next) return null;
  return (
    <Link
      className="mt-4 flex items-center gap-3 rounded-lg bg-card px-4 py-3 text-foreground no-underline shadow-sm transition-shadow duration-150 ease-standard hover:shadow-lg focus-visible:shadow-focus focus-visible:outline-none [&>svg]:text-muted-foreground"
      href="/profile"
    >
      <Ring value={next.current / next.target}>
        <Medallion badge={next.key} level={next.level} size={26} decorative />
      </Ring>
      <span className="grid min-w-0 flex-1 [&_span]:text-sm [&_span]:text-muted-foreground [&_strong]:text-base [&_strong]:font-semibold">
        <strong>{badgeDefinition(next.key).name}</strong>
        <span>{progressLabel(next.key, next.target - next.current)}</span>
      </span>
      <CaretRightIcon size={18} aria-hidden="true" />
    </Link>
  );
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("") || "?";

const earnedLine = "m-0 max-w-[26ch] text-muted-foreground";
const shelfItem =
  "grid min-h-touch w-full content-start justify-items-center gap-1 rounded-md border-0 bg-transparent p-1 text-center text-xs font-semibold text-inherit [font-family:inherit] [button&]:cursor-pointer [button&]:focus-visible:shadow-focus [button&]:focus-visible:outline-none **:data-[slot=medallion]:mb-1";

/** Initials inside the brand's gradient ring: the profile head and its menu entry. */
export function RingAvatar({
  name,
  size,
}: {
  name: string;
  size: "sm" | "lg";
}) {
  return (
    <span
      className={cx(
        "block flex-none rounded-full bg-[conic-gradient(from_200deg,var(--brand-orange),var(--badge-glow),var(--badge-ring-sky),var(--brand-orange))]",
        size === "lg" ? "size-22 p-0.75" : "size-full p-0.5",
      )}
      aria-hidden="true"
    >
      <span
        data-slot="avatar-face"
        className={cx(
          "grid size-full place-items-center rounded-full bg-card font-heading font-extrabold text-foreground",
          size === "lg"
            ? "border-3 border-background text-2xl"
            : "border-2 border-card text-sm tracking-tight",
        )}
      >
        {initials(name)}
      </span>
    </span>
  );
}

/**
 * What the person plays, in a card of its own (D-15/D-23): each activity with
 * its icon and its level in words, backed by a three-step meter. Levels are
 * the person's own rating, said once in the heading. Owner and visitors read
 * the same card; an owner with nothing added gets a way to add some.
 */
function Plays({
  activities,
  owner,
}: {
  /** Null until loaded, so an empty card never flashes first. */
  activities: ProfileActivity[] | null;
  owner: boolean;
}) {
  const { catalog } = useActivities();
  if (!activities || (!activities.length && !owner)) return null;
  return (
    <section aria-labelledby="plays-title">
      <div className="mt-8 mb-3 flex items-center justify-between gap-3 [&_h2]:m-0">
        <h2 id="plays-title">Plays</h2>
        {activities.some((a) => a.level) ? (
          <span className="rounded-full border border-border px-2 py-0.5 text-xs font-semibold text-muted-foreground">
            Self-rated
          </span>
        ) : null}
      </div>
      {activities.length ? (
        <ul className="m-0 list-none overflow-hidden rounded-lg bg-card p-0 shadow-sm">
          {activities.map((a) => (
            <li
              key={a.name}
              className="flex min-h-15 items-center gap-3 border-t border-border py-2 pr-4 pl-3 first:border-t-0"
            >
              <span
                className="inline-flex size-10 flex-none items-center justify-center rounded-full bg-success text-success-foreground"
                aria-hidden="true"
              >
                <ActivityIcon
                  icon={
                    catalog?.find((c) => c.key === a.key)?.icon ??
                    a.key ??
                    "general"
                  }
                  size={22}
                />
              </span>
              <span className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-3 gap-y-0.5">
                <span className="min-w-0 font-semibold wrap-anywhere">
                  {a.name}
                </span>
                <span className="inline-flex flex-none items-center gap-2 text-sm font-medium text-muted-foreground">
                  <span
                    className="group/meter inline-flex h-4 items-end gap-0.75 *:w-1.25 *:rounded-full *:bg-input [&>span:nth-child(1)]:h-2 [&>span:nth-child(2)]:h-3 [&>span:nth-child(3)]:h-4 data-[step=1]:[&>span:nth-child(-n+1)]:bg-success-foreground data-[step=2]:[&>span:nth-child(-n+2)]:bg-success-foreground data-[step=3]:*:bg-success-foreground"
                    data-step={levelStep(a.level)}
                    aria-hidden="true"
                  >
                    <span />
                    <span />
                    <span />
                  </span>
                  {a.level ? levelLabel[a.level] : "Not rated"}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="grid justify-items-start gap-3 rounded-lg bg-card p-4 shadow-sm [&_p]:m-0 [&_p]:text-muted-foreground">
          <p>
            Add the activities you play, so hosts know what to invite you to.
          </p>
          <Link
            className={buttonClass({ variant: "secondary", size: "sm" })}
            href="/profile/edit"
          >
            Add activities
          </Link>
        </div>
      )}
    </section>
  );
}

interface ShelfBadge {
  key: BadgeKey;
  level: 0 | Level;
}

/** Only the owner's view has these: the controls, details and account. */
interface OwnerParts {
  /** Unknown until the account loads; there is no link to share before then. */
  profileId: string | null;
  /** Stands in for the stats and badges while they load or fail to load. */
  status?: ReactNode;
  titleControl?: ReactNode;
  /** Opens a badge's levels; the public shelf is not interactive. */
  onOpen: (key: BadgeKey) => void;
  /** More actions at the end of the Edit/Share row, such as Sign out. */
  moreActions?: ReactNode;
  /** A problem with one of those actions, shown right under the row. */
  actionsNotice?: ReactNode;
  /**
   * The account's email, under the name. Owner only: the public profile
   * never carries it, so a shared link shows no contact details.
   */
  email: string | null;
}

const dateLabel = (value: string) =>
  new Date(value).toLocaleDateString(undefined, { dateStyle: "medium" });

/**
 * One badge's five levels, what each needs, and what is next (owner only). A
 * badge not started yet says what it counts and the first thing to do.
 */
function BadgeDetails({
  state,
  onClose,
}: {
  state: BadgeState | null;
  onClose: () => void;
}) {
  const key = state?.key ?? "rally";
  const definition = badgeDefinition(key);
  const level = state ? levelOf(state) : 0;
  const target = state ? nextTarget(key, state.current) : null;
  return (
    <Sheet open={state !== null} onClose={onClose} title={definition.name}>
      {state ? (
        <div className="grid justify-items-center gap-2">
          <Medallion badge={key} level={level} size={96} />
          <p className="m-0 font-semibold text-muted-foreground">
            {badgeLevelLabel(level)}
          </p>
          <p className="m-0 max-w-[32ch] text-center text-muted-foreground">
            {badgeAbout(key)}
          </p>
          {level === 0 ? (
            <div className="my-2 grid w-full gap-0.5 rounded-md bg-muted p-3 text-center [&_p]:m-0 [&_p]:font-semibold">
              <p className="text-sm text-muted-foreground">How to earn it</p>
              <p>{firstStep(key)}</p>
            </div>
          ) : null}
          <ol className="mt-2 mb-0 grid w-full list-none gap-2 p-0">
            {definition.thresholds.map((_, i) => {
              const step = (i + 1) as Level;
              const earned = state.levels.find((l) => l.level === step);
              return (
                <li
                  key={step}
                  className={cx(
                    "flex min-h-touch items-center gap-3 rounded-md bg-muted px-3 py-2 text-muted-foreground",
                    earned && "text-foreground",
                  )}
                >
                  <Medallion
                    badge={key}
                    level={earned ? step : 0}
                    size={28}
                    decorative
                  />
                  <span className="grid min-w-0 flex-1 text-sm [&_strong]:font-semibold">
                    <strong>Level {step}</strong>
                    <span>
                      {levelTarget(key, step)} · “{levelTitle(key, step)}”
                    </span>
                  </span>
                  {earned ? (
                    <span className="inline-flex items-center gap-1 text-xs whitespace-nowrap">
                      <CheckIcon size={16} weight="bold" aria-hidden="true" />
                      <span className="sr-only">Earned </span>
                      {dateLabel(earned.earnedAt)}
                    </span>
                  ) : (
                    <span className="sr-only">Not yet</span>
                  )}
                </li>
              );
            })}
          </ol>
          {target !== null && state.current > 0 ? (
            <p className="mt-2 mb-0 text-center font-semibold">
              {progressLabel(key, target - state.current)} for level {level + 1}
            </p>
          ) : null}
        </div>
      ) : null}
    </Sheet>
  );
}

/**
 * One profile, for its owner and for anyone with the link. The public view
 * shows started badges at their level and nothing else about them; the
 * owner's shows all six, each opening its levels.
 */
function ProfileView({
  name,
  title,
  badges,
  stats,
  activities,
  ranks,
  owner,
}: {
  name: string;
  title: RosterTitle | null;
  badges: ShelfBadge[];
  stats: BadgesView["stats"];
  activities: ProfileActivity[] | null;
  /** The read's raw ranks; anything unrecognised shows nothing. */
  ranks: unknown;
  owner?: OwnerParts;
}) {
  const shelf = owner ? badges : badges.filter((b) => b.level > 0);
  return (
    <section className="mx-auto max-w-160">
      <div className="mb-6 grid justify-items-center gap-2 text-center [&_h1]:m-0 **:data-[slot=title-pill]:ml-0 **:data-[slot=title-pill]:text-sm">
        <RingAvatar name={name} size="lg" />
        <h1>{name || "Your profile"}</h1>
        {owner?.email ? (
          <p className="-mt-2 mb-0 max-w-full text-sm wrap-anywhere text-muted-foreground">
            {owner.email}
          </p>
        ) : null}
        {title ? <TitlePill title={title} /> : null}
        {owner ? (
          <div className="mt-2 flex w-full max-w-104 justify-center gap-2">
            <Link
              className={cx(
                buttonClass({ variant: "secondary" }),
                "min-w-0 flex-[1_1_0] px-3",
              )}
              href="/profile/edit"
            >
              <PencilSimpleIcon size={18} aria-hidden="true" />
              <span>
                Edit<span className="max-[25rem]:sr-only"> profile</span>
              </span>
            </Link>
            {owner.profileId ? (
              <ShareButton
                title={`${name} on RallyPoint`}
                className="min-w-0 flex-[1_1_0] px-3"
                label={
                  <span>
                    Share<span className="max-[25rem]:sr-only"> profile</span>
                  </span>
                }
                url={
                  typeof window === "undefined"
                    ? undefined
                    : `${window.location.origin}/people/${owner.profileId}`
                }
              />
            ) : null}
            {owner.moreActions}
          </div>
        ) : null}
        {owner?.actionsNotice}
      </div>
      {/* Plays follows the numbers; while those load or fail, it follows the
          message that stands in for them, so it never disappears. */}
      {owner?.status ? (
        <>
          {owner.status}
          <Plays activities={activities} owner />
        </>
      ) : (
        <>
          <StatRow
            items={[
              { label: "played", value: stats.played },
              { label: "hosted", value: stats.hosted },
              {
                label: stats.groups === 1 ? "group" : "groups",
                value: stats.groups,
              },
            ]}
          />
          <Plays activities={activities} owner={!!owner} />
          <Ranked ranks={ranks} />
          {shelf.length ? (
            <div className="mt-8 mb-3 flex items-center justify-between gap-3 [&_h2]:m-0">
              <h2>Badges</h2>
              {owner?.titleControl}
            </div>
          ) : null}
          {owner && !badges.some((b) => b.level > 0) ? (
            <p className="mt-1 mb-0 text-sm text-muted-foreground">
              Your first badge comes with your first check-in.
            </p>
          ) : null}
          <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(92px,1fr))] gap-x-3 gap-y-5 p-0 text-center">
            {shelf.map((b) => {
              const content = (
                <>
                  <Medallion
                    badge={b.key}
                    level={b.level}
                    size={64}
                    decorative
                  />
                  <span>{badgeDefinition(b.key).name}</span>
                  <small>{badgeLevelLabel(b.level)}</small>
                </>
              );
              return (
                <li
                  key={b.key}
                  className={cx(
                    "[&_small]:font-normal [&_small]:text-muted-foreground",
                    !b.level &&
                      "[&_span:not([data-slot])]:font-medium [&_span:not([data-slot])]:text-muted-foreground",
                  )}
                >
                  {/* The visible name and level are the accessible name (WCAG 2.5.3). */}
                  {owner ? (
                    <button
                      type="button"
                      className={shelfItem}
                      aria-haspopup="dialog"
                      onClick={() => owner.onOpen(b.key)}
                    >
                      {content}
                    </button>
                  ) : (
                    <span className={shelfItem}>{content}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}

export function ProfilePage() {
  const { session } = useAuth();
  const account = useSignOut();
  const identity = useApi<Identity>("/api/me");
  const profile = useApi<{ profile: MyProfile }>("/api/me/profile");
  const badges = useApi<BadgesView>("/api/me/badges");
  const write = useBadgeWrites();
  const [saved, setSaved] = useState<BadgesView | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [choice, setChoice] = useState("");
  const [open, setOpen] = useState<BadgeKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const view = saved ?? badges.data;
  const name = identity.data?.displayName ?? "";
  const shelf = badgeCatalog.map((b) => {
    const state = badgeStates(view).find((x) => x.key === b.key);
    return { key: b.key, level: state ? levelOf(state) : 0 } as ShelfBadge;
  });
  // A title is any started badge; it always reads the badge's current level.
  const titles = shelf.filter(
    (b): b is { key: BadgeKey; level: Level } => b.level > 0,
  );
  async function saveTitle(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setSaved(await write("/api/me/title", { badgeId: choice || null }));
      setChoosing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  const status =
    badges.loading && !view ? (
      <BadgesSkeleton label="Loading your badges…" />
    ) : badges.error && !view ? (
      <Notice retry={badges.retry}>{badges.error}</Notice>
    ) : undefined;
  return (
    <>
      {identity.error ? (
        <Notice retry={identity.retry}>{identity.error}</Notice>
      ) : null}
      {profile.error && !profile.data ? (
        <Notice retry={profile.retry}>{profile.error}</Notice>
      ) : null}
      <ProfileView
        name={name}
        title={rosterTitle(view?.title)}
        badges={shelf}
        stats={view?.stats ?? { played: 0, hosted: 0, groups: 0 }}
        activities={profile.data?.profile.activities ?? null}
        ranks={view?.ranks}
        owner={{
          profileId: identity.data?.profileId ?? null,
          status,
          onOpen: setOpen,
          titleControl: titles.length ? (
            <button
              type="button"
              className={buttonClass({ variant: "link" })}
              onClick={() => {
                setChoice(rosterTitle(view?.title)?.key ?? "");
                setError(null);
                setChoosing(true);
              }}
            >
              Choose title
            </button>
          ) : null,
          // Icon only, so its name and tooltip say what it does.
          moreActions: (
            <button
              type="button"
              className={cx(iconButtonClass(), "size-control")}
              aria-label={account.leaving ? "Signing out…" : "Sign out"}
              title="Sign out"
              onClick={() => void account.signOut()}
              disabled={account.leaving}
            >
              <SignOutIcon size={20} aria-hidden="true" />
            </button>
          ),
          actionsNotice: account.error ? (
            <Notice>{account.error}</Notice>
          ) : null,
          email: session?.user.email ?? null,
        }}
      />
      {profile.data ? (
        <ProfileVisibility
          initial={profile.data.profile.discoverable !== false}
        />
      ) : null}
      <BadgeDetails
        state={open ? badgeOrEmpty(view, open) : null}
        onClose={() => setOpen(null)}
      />
      <Sheet
        open={choosing}
        onClose={() => setChoosing(false)}
        title="Your title"
      >
        <form
          className="[&_fieldset]:mt-3 [&_fieldset]:mb-4 [&_fieldset]:grid [&_fieldset]:gap-2 [&_label]:flex [&_label]:min-h-touch [&_label]:cursor-pointer [&_label]:items-center [&_label]:gap-3 [&_label]:rounded-md [&_label]:border [&_label]:border-border [&_label]:px-3 [&_label]:py-2 [&_label]:has-checked:border-chrome [&_label]:has-checked:shadow-ring-chrome **:data-[slot=title-pill]:ml-0"
          onSubmit={saveTitle}
        >
          <p className="mt-1 mb-0 text-sm text-muted-foreground">
            Shown next to your name on session lists.
          </p>
          <fieldset>
            <legend className="sr-only">Title</legend>
            <label>
              <input
                type="radio"
                name="title"
                value=""
                checked={choice === ""}
                onChange={() => setChoice("")}
              />
              <span>No title</span>
            </label>
            {titles.map((t) => (
              <label key={t.key}>
                <input
                  type="radio"
                  name="title"
                  value={t.key}
                  checked={choice === t.key}
                  onChange={() => setChoice(t.key)}
                />
                <span className="grid min-w-0 justify-items-start gap-0.5 [&_small]:text-xs [&_small]:text-muted-foreground">
                  <TitlePill title={t} />
                  <small>
                    {badgeDefinition(t.key).name} · level {t.level}
                  </small>
                </span>
              </label>
            ))}
          </fieldset>
          {error ? <Notice>{error}</Notice> : null}
          <button
            type="submit"
            className={buttonClass({ variant: "primary", wide: true })}
            disabled={busy}
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </form>
      </Sheet>
    </>
  );
}

/**
 * Whether Search can find you by name (D-27): public by default, one quiet
 * row at the foot of your profile. Your page stays reachable by its link.
 */
function ProfileVisibility({ initial }: { initial: boolean }) {
  const { session } = useAuth();
  const [discoverable, setDiscoverable] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function change(next: boolean) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/me/profile/discoverable", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ discoverable: next }),
        signal: AbortSignal.timeout(10000),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error?.message ?? "Please try again.");
      setDiscoverable(result.discoverable);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      aria-label="Profile visibility"
      className="mx-auto mt-6 max-w-form"
    >
      <SwitchField
        checked={discoverable}
        onCheckedChange={(next) => void change(next)}
        disabled={busy}
        description={
          discoverable
            ? "Public profile: anyone signed in can find you by name."
            : "Private profile: only people who already have your link see it."
        }
      >
        Show me in Search
      </SwitchField>
      {error ? (
        <p role="alert" className="m-0 text-sm text-danger-foreground">
          {error}
        </p>
      ) : null}
    </section>
  );
}

const isLevel = (n: number): n is Level =>
  Number.isInteger(n) && n >= 1 && n <= 5;

/** Someone else's profile, open to anyone with the link, signed in or not. */
export function PersonProfilePage() {
  const { id } = useParams<{ id: string }>();
  const { session } = useAuth();
  const result = useApi<{ profile: PublicProfile }>(`/api/people/${id}`, true);
  const profile = result.data?.profile;
  if (result.loading)
    return (
      <section className="mx-auto max-w-160">
        <ProfileSkeleton label="Opening the profile…" />
      </section>
    );
  if (!profile)
    return (
      <section className="mx-auto max-w-160">
        {result.error === "Profile not found" ? (
          <EmptyState
            headingLevel={1}
            icon={<span className="tabular-nums">404</span>}
            title="Profile not found"
            action={
              <Link className={buttonClass({ variant: "primary" })} href="/">
                Home
              </Link>
            }
          >
            The link may be incomplete.
          </EmptyState>
        ) : (
          <Notice retry={result.retry}>
            {result.error ?? "Please try again."}
          </Notice>
        )}
      </section>
    );
  // Started badges at their level, in catalog order.
  const shelf = badgeCatalog.flatMap((b) => {
    const level = profile.badges.find((x) => x.key === b.key)?.level ?? 0;
    return isLevel(level) ? [{ key: b.key, level }] : [];
  });
  return (
    <>
      {session ? <OwnProfileRedirect profileId={profile.profileId} /> : null}
      <ProfileView
        name={profile.name}
        title={rosterTitle(profile.title)}
        badges={shelf}
        stats={profile.stats}
        activities={profile.activities}
        ranks={profile.ranks}
      />
    </>
  );
}

/** Your own link opens your own profile, with its controls. */
function OwnProfileRedirect({ profileId }: { profileId: string }) {
  const router = useRouter();
  const identity = useApi<Identity>("/api/me");
  const own = identity.data?.profileId === profileId;
  useEffect(() => {
    if (own) router.replace("/profile");
  }, [own, router]);
  return null;
}
