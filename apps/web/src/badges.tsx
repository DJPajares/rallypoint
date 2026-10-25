"use client";
import { useEffect, useId, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/csr/PencilSimple";
import { SignOutIcon } from "@phosphor-icons/react/dist/csr/SignOut";
import {
  badgeCatalog,
  badgeDefinition,
  badgeStates,
  legacyTitles,
  levelColors,
  levelLabel as badgeLevelLabel,
  levelOf,
  levelSentence,
  levelTarget,
  medallionLabel,
  newestUnseen,
  nextBadge,
  nextTarget,
  progressLabel,
  titleForLevel,
  titleLabel,
  titleOptions,
  unseenIds,
} from "@rallypoint/domain/badges";
import type {
  BadgeGlyph,
  BadgeKey,
  BadgeState,
  BadgesView,
  LegacyBadgeKey,
  Level,
  RosterTitle,
} from "@rallypoint/domain/badges";
import type { Identity } from "@rallypoint/domain/contracts";
import { levelLabel } from "@rallypoint/domain/profile";
import type {
  MyProfile,
  ProfileActivity,
  PublicProfile,
} from "@rallypoint/domain/profile";
import {
  buttonClass,
  cx,
  EmptyState,
  Notice,
  Pending,
  Sheet,
  StatRow,
} from "@rallypoint/ui";
import { useAuth } from "./auth-context";
import { useApi } from "./use-api";
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
      className={cx("medallion", !colors && "medallion--locked")}
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
            fill="var(--palette-white)"
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
    <Link className="person-link" href={`/people/${profileId}`}>
      {name}
    </Link>
  ) : (
    <>{name}</>
  );
}

/** A title still names an old badge (WDL-405); it shows the level it became. */
export function TitlePill({ title }: { title: RosterTitle }) {
  const shows = legacyTitles[title.key].shows;
  return (
    <span className={cx("title-pill", !shows && "title-pill--plain")}>
      {shows ? (
        <Medallion badge={shows.key} level={shows.level} size={18} decorative />
      ) : null}
      {titleLabel(title)}
    </span>
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
  const moment = newestUnseen(badgeStates(view));
  if (!view || !moment) return null;
  const unseen = unseenIds(badgeStates(view));
  const { key, level, more } = moment;
  // Until WDL-405, a level can be shown as a title only through its old badge.
  const legacy = titleForLevel(key, level);
  const title = legacy
    ? titleOptions(view).find((t) => t.id === legacy)
    : undefined;
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
      <div className="earned-badge">
        <div className="earned-badge__halo">
          <Medallion badge={key} level={level} size={132} />
        </div>
        <p className="earned-badge__name">
          {badgeDefinition(key).name} · Level {level}
        </p>
        <p className="earned-badge__line">{levelSentence(key, level)}</p>
        {more ? (
          <Link className="earned-badge__more" href="/profile" onClick={close}>
            +{more} more on your profile
          </Link>
        ) : null}
        {error ? <Notice>{error}</Notice> : null}
        {title ? (
          <button
            type="button"
            className={buttonClass({ variant: "primary", wide: true })}
            disabled={busy}
            onClick={() => showAsTitle(title.id)}
          >
            {busy ? "Saving…" : "Show as my title"}
          </button>
        ) : null}
        <button
          type="button"
          className={buttonClass({
            variant: title ? "link" : "primary",
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
    <span className="progress-ring" aria-hidden="true">
      <svg viewBox="0 0 44 44" width="44" height="44">
        <circle className="progress-ring__track" cx="22" cy="22" r="19" />
        <circle
          className="progress-ring__value"
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
    <Link className="next-badge" href="/profile">
      <Ring value={next.current / next.target}>
        <Medallion badge={next.key} level={next.level} size={26} decorative />
      </Ring>
      <span className="next-badge__text">
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

/** Initials inside the brand's gradient ring: the profile head and its menu entry. */
export function RingAvatar({
  name,
  size,
}: {
  name: string;
  size: "sm" | "lg";
}) {
  return (
    <span className={`ring-avatar ring-avatar--${size}`} aria-hidden="true">
      <span>{initials(name)}</span>
    </span>
  );
}

/** Owner and visitors read the same line: each level is marked as the person's own rating. */
const playsLineSelfRated = (activities: ProfileActivity[]) =>
  activities.length === 0
    ? ""
    : `Plays: ${activities
        .map((a) =>
          a.level ? `${a.name} (${levelLabel[a.level]} · self-rated)` : a.name,
        )
        .join(", ")}`;

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
  footer: ReactNode;
}

const dateLabel = (value: string) =>
  new Date(value).toLocaleDateString(undefined, { dateStyle: "medium" });

/** One badge's five levels, what each needs, and what is next (owner only). */
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
        <div className="badge-details">
          <Medallion badge={key} level={level} size={96} />
          <p className="badge-details__status">{badgeLevelLabel(level)}</p>
          <ol className="badge-levels">
            {definition.thresholds.map((_, i) => {
              const step = (i + 1) as Level;
              const earned = state.levels.find((l) => l.level === step);
              return (
                <li key={step} className={cx(earned && "badge-levels__earned")}>
                  <Medallion
                    badge={key}
                    level={earned ? step : 0}
                    size={28}
                    decorative
                  />
                  <span className="badge-levels__text">
                    <strong>Level {step}</strong>
                    <span>{levelTarget(key, step)}</span>
                  </span>
                  {earned ? (
                    <span className="badge-levels__when">
                      <CheckIcon size={16} weight="bold" aria-hidden="true" />
                      <span className="rp-sr-only">Earned </span>
                      {dateLabel(earned.earnedAt)}
                    </span>
                  ) : (
                    <span className="rp-sr-only">Not yet</span>
                  )}
                </li>
              );
            })}
          </ol>
          {target !== null ? (
            <p className="badge-details__next">
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
  owner,
}: {
  name: string;
  title: RosterTitle | null;
  badges: ShelfBadge[];
  stats: BadgesView["stats"];
  activities: ProfileActivity[];
  owner?: OwnerParts;
}) {
  const plays = playsLineSelfRated(activities);
  const shelf = owner ? badges : badges.filter((b) => b.level > 0);
  return (
    <section className="page profile-page">
      <div className="profile-head">
        <RingAvatar name={name} size="lg" />
        <h1>{name || "Your profile"}</h1>
        {title ? <TitlePill title={title} /> : null}
        {plays ? <p className="profile-plays">{plays}</p> : null}
        {owner ? (
          <div className="profile-actions">
            <Link
              className={buttonClass({ variant: "secondary" })}
              href="/profile/edit"
            >
              <PencilSimpleIcon size={18} aria-hidden="true" />
              Edit profile
            </Link>
            {owner.profileId ? (
              <ShareButton
                title={`${name} on RallyPoint`}
                label="Share profile"
                url={
                  typeof window === "undefined"
                    ? undefined
                    : `${window.location.origin}/people/${owner.profileId}`
                }
              />
            ) : null}
          </div>
        ) : null}
      </div>
      {owner?.status ?? (
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
          {shelf.length ? (
            <div className="section-head">
              <h2>Badges</h2>
              {owner?.titleControl}
            </div>
          ) : null}
          {owner && !badges.some((b) => b.level > 0) ? (
            <p className="rp-help">
              Your first badge comes with your first check-in.
            </p>
          ) : null}
          <ul className="badge-shelf">
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
                  className={cx(!b.level && "badge-shelf__locked")}
                >
                  {/* The visible name and level are the accessible name (WCAG 2.5.3). */}
                  {owner ? (
                    <button
                      type="button"
                      className="badge-shelf__item"
                      aria-haspopup="dialog"
                      onClick={() => owner.onOpen(b.key)}
                    >
                      {content}
                    </button>
                  ) : (
                    <span className="badge-shelf__item">{content}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
      {owner?.footer}
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
  const titles = titleOptions(view);
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
      <Pending>Loading your badges…</Pending>
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
        title={view?.title ?? null}
        badges={shelf}
        stats={view?.stats ?? { played: 0, hosted: 0, groups: 0 }}
        activities={profile.data?.profile.activities ?? []}
        owner={{
          profileId: identity.data?.profileId ?? null,
          status,
          onOpen: setOpen,
          titleControl: titles.length ? (
            <button
              type="button"
              className={buttonClass({ variant: "link" })}
              onClick={() => {
                setChoice(view?.title?.id ?? "");
                setError(null);
                setChoosing(true);
              }}
            >
              Choose title
            </button>
          ) : null,
          footer: (
            <>
              <div className="section-head">
                <h2>Account</h2>
              </div>
              <div className="profile-account">
                <p>
                  Signed in as
                  <br />
                  <strong>{session?.user.email ?? "your account"}</strong>
                </p>
                {account.error ? <Notice>{account.error}</Notice> : null}
                <button
                  type="button"
                  className={buttonClass({ wide: true })}
                  onClick={() => void account.signOut()}
                  disabled={account.leaving}
                >
                  <SignOutIcon size={20} aria-hidden="true" />
                  {account.leaving ? "Signing out…" : "Sign out"}
                </button>
              </div>
            </>
          ),
        }}
      />
      <BadgeDetails
        state={(open && badgeStates(view).find((b) => b.key === open)) || null}
        onClose={() => setOpen(null)}
      />
      <Sheet
        open={choosing}
        onClose={() => setChoosing(false)}
        title="Your title"
      >
        <form className="title-choice" onSubmit={saveTitle}>
          <p className="rp-help">Shown next to your name on session lists.</p>
          <fieldset>
            <legend className="rp-sr-only">Title</legend>
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
              <label key={t.id}>
                <input
                  type="radio"
                  name="title"
                  value={t.id}
                  checked={choice === t.id}
                  onChange={() => setChoice(t.id)}
                />
                <TitlePill title={t} />
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
      <section className="page profile-page">
        <Pending>Opening the profile…</Pending>
      </section>
    );
  if (!profile)
    return (
      <section className="page profile-page">
        {result.error === "Profile not found" ? (
          <EmptyState
            headingLevel={1}
            icon={<span className="rp-nums">404</span>}
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
  const title =
    profile.title && Object.hasOwn(legacyTitles, profile.title.key)
      ? { key: profile.title.key as LegacyBadgeKey, groupName: null }
      : null;
  return (
    <>
      {session ? <OwnProfileRedirect profileId={profile.profileId} /> : null}
      <ProfileView
        name={profile.name}
        title={title}
        badges={shelf}
        stats={profile.stats}
        activities={profile.activities}
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
