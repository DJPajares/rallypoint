"use client";
import { useEffect, useId, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/csr/PencilSimple";
import { SignOutIcon } from "@phosphor-icons/react/dist/csr/SignOut";
import {
  badgeCatalog,
  badgeDefinition,
  earnedSentence,
  newestUnseen,
  nextBadge,
  progressLabel,
  titleLabel,
} from "@rallypoint/domain/badges";
import type {
  BadgeDefinition,
  BadgeKey,
  BadgesView,
  RosterTitle,
} from "@rallypoint/domain/badges";
import type { Identity } from "@rallypoint/domain/contracts";
import { levelLabel, playsLine } from "@rallypoint/domain/profile";
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
// glint and a single glyph (PRD D-15). Locked ones are a dashed outline.
function Glyph({ badge }: { badge: BadgeDefinition }) {
  const line = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 5,
    strokeLinecap: "round",
    strokeLinejoin: "round",
  } as const;
  switch (badge.glyph) {
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
    case "regular":
      return (
        <>
          <rect x="29" y="32" width="42" height="39" rx="8" {...line} />
          <path d="M29 45 H71 M40 26 V36 M60 26 V36" {...line} />
          <path d="M40 58 L47 64 L61 51" {...line} />
        </>
      );
    case "number":
      return (
        <text
          x="50"
          y={badge.label!.length > 2 ? 59 : 61}
          textAnchor="middle"
          fontFamily="var(--font-heading)"
          fontWeight="800"
          fontSize={badge.label!.length > 2 ? 26 : 31}
          fill="currentColor"
        >
          {badge.label}
        </text>
      );
    case "bench":
      return (
        <>
          <path d="M50 66 V32 M37 45 L50 32 L63 45" {...line} />
          <path d="M33 73 H67" {...line} />
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
    case "founder":
      return (
        <>
          <path d="M50 73 V49 M35 74 H65" {...line} />
          <path
            d="M50 55 C39 55 31 47 31 36 C42 36 50 44 50 55 Z"
            fill="currentColor"
          />
          <path
            d="M50 49 C50 38 58 30 70 30 C70 42 62 49 50 49 Z"
            fill="currentColor"
          />
        </>
      );
  }
}

export function Medallion({
  badge,
  size,
  locked = false,
  decorative = false,
}: {
  badge: BadgeKey;
  size: number;
  locked?: boolean;
  /** Hide from assistive tech when a visible label already names it. */
  decorative?: boolean;
}) {
  const definition = badgeDefinition(badge);
  const gradient = `medal-${useId().replace(/[^\w-]/g, "")}`;
  return (
    <svg
      className={cx("medallion", locked && "medallion--locked")}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      {...(decorative
        ? { "aria-hidden": true }
        : {
            role: "img",
            "aria-label": locked
              ? `${definition.name}, not earned yet`
              : definition.name,
          })}
    >
      {locked ? (
        <circle
          cx="50"
          cy="50"
          r="45"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeDasharray="5 6"
        />
      ) : (
        <>
          <defs>
            <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor={definition.colors[0]} />
              <stop offset="1" stopColor={definition.colors[1]} />
            </linearGradient>
          </defs>
          <circle cx="50" cy="50" r="47" fill={`url(#${gradient})`} />
          <circle
            cx="50"
            cy="50"
            r="38.5"
            fill="none"
            stroke="var(--badge-shine)"
            strokeOpacity=".38"
            strokeWidth="1.6"
          />
          <path
            d="M17 44 A34 34 0 0 1 56 15"
            fill="none"
            stroke="var(--badge-shine)"
            strokeOpacity=".4"
            strokeWidth="5"
            strokeLinecap="round"
          />
        </>
      )}
      <g
        style={{
          color: locked
            ? "inherit"
            : definition.darkGlyph
              ? "var(--badge-ink-dark)"
              : "var(--badge-ink-light)",
        }}
      >
        <Glyph badge={definition} />
      </g>
    </svg>
  );
}

export function TitlePill({ title }: { title: RosterTitle }) {
  return (
    <span className="title-pill">
      <Medallion badge={title.key} size={18} decorative />
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
 * A new badge gets one moment: shown once, then marked seen whichever way the
 * sheet is closed. Nothing is pushed or emailed (PRD D-16).
 */
export function EarnedBadgeSheet({ view }: { view: BadgesView | null }) {
  const write = useBadgeWrites();
  const [closed, setClosed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const moment = view ? newestUnseen(view.earned) : null;
  if (!view || !moment) return null;
  const unseen = view.earned.filter((b) => !b.seen).map((b) => b.id);
  const { badge, more } = moment;
  function close() {
    setClosed(true);
    // If this fails the badge simply shows again next time; nothing is lost.
    write("/api/me/badges/seen", { ids: unseen.slice(0, 50) }).catch(() => {});
  }
  async function showAsTitle() {
    setBusy(true);
    setError(null);
    try {
      await write("/api/me/title", { badgeId: badge.id });
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
          <Medallion badge={badge.key} size={132} />
        </div>
        {/* The sentence names the group, so the heading doesn't repeat it. */}
        <p className="earned-badge__name">{badgeDefinition(badge.key).name}</p>
        <p className="earned-badge__line">{earnedSentence(badge)}</p>
        {more ? (
          <Link className="earned-badge__more" href="/profile" onClick={close}>
            +{more} more on your profile
          </Link>
        ) : null}
        {error ? <Notice>{error}</Notice> : null}
        <button
          type="button"
          className={buttonClass({ variant: "primary", wide: true })}
          disabled={busy}
          onClick={showAsTitle}
        >
          {busy ? "Saving…" : "Show as my title"}
        </button>
        <button
          type="button"
          className={buttonClass({ variant: "link", wide: true })}
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

/** One quiet nudge toward the closest badge; nothing when none is under way. */
export function NextBadge({ view }: { view: BadgesView | null }) {
  const next = view ? nextBadge(view.progress) : null;
  if (!next) return null;
  return (
    <Link className="next-badge" href="/profile">
      <Ring value={next.current / next.target}>
        <Medallion badge={next.key} size={26} decorative />
      </Ring>
      <span className="next-badge__text">
        <strong>{badgeDefinition(next.key).name}</strong>
        <span>{progressLabel(next)}</span>
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

/** What the public sees: each level is marked as the person's own rating. */
const publicPlaysLine = (activities: ProfileActivity[]) =>
  activities.length === 0
    ? ""
    : `Plays: ${activities
        .map((a) =>
          a.level ? `${a.name} (${levelLabel[a.level]} · self-rated)` : a.name,
        )
        .join(", ")}`;

interface ViewBadge {
  key: BadgeKey;
  /** Only the owner's own view names the group. */
  groupName?: string | null;
}

/** Only the owner's view has these: the controls, locked badges and account. */
interface OwnerParts {
  /** Unknown until the account loads; there is no link to share before then. */
  profileId: string | null;
  /** Stands in for the stats and badges while they load or fail to load. */
  status?: ReactNode;
  titleControl?: ReactNode;
  locked: BadgeDefinition[];
  footer: ReactNode;
}

/**
 * One profile, for its owner and for anyone with the link. The public view
 * carries no group names and no controls; the owner's adds both.
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
  badges: ViewBadge[];
  stats: BadgesView["stats"];
  activities: ProfileActivity[];
  owner?: OwnerParts;
}) {
  const plays = owner ? playsLine(activities) : publicPlaysLine(activities);
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
          {owner || badges.length ? (
            <div className="section-head">
              <h2>Badges</h2>
              {owner?.titleControl}
            </div>
          ) : null}
          {owner && !badges.length ? (
            <p className="rp-help">
              Your first badge comes with your first check-in.
            </p>
          ) : null}
          <ul className="badge-shelf">
            {badges.map((b, index) => (
              <li key={`${b.key}-${index}`}>
                <Medallion badge={b.key} size={64} decorative />
                <span>{badgeDefinition(b.key).name}</span>
                {b.groupName ? <small>{b.groupName}</small> : null}
              </li>
            ))}
            {owner?.locked.map((b) => (
              <li key={b.key} className="badge-shelf__locked">
                <Medallion badge={b.key} size={64} locked decorative />
                <span>
                  {b.name}
                  <span className="rp-sr-only">, not earned yet</span>
                </span>
              </li>
            ))}
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const view = saved ?? badges.data;
  const name = identity.data?.displayName ?? "";
  const earnedKeys = new Set(view?.earned.map((b) => b.key));
  const order = new Map(badgeCatalog.map((b, i) => [b.key, i]));
  const earned = [...(view?.earned ?? [])].sort(
    (a, b) => order.get(a.key)! - order.get(b.key)!,
  );
  const locked = badgeCatalog.filter((b) => !earnedKeys.has(b.key));
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
        badges={earned}
        stats={view?.stats ?? { played: 0, hosted: 0, groups: 0 }}
        activities={profile.data?.profile.activities ?? []}
        owner={{
          profileId: identity.data?.profileId ?? null,
          status,
          titleControl: earned.length ? (
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
          locked,
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
            {earned.map((b) => (
              <label key={b.id}>
                <input
                  type="radio"
                  name="title"
                  value={b.id}
                  checked={choice === b.id}
                  onChange={() => setChoice(b.id)}
                />
                <TitlePill title={b} />
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
  // Each badge once, in catalog order, whichever group it came from.
  const earliest = new Map<BadgeKey, string>();
  for (const b of profile.badges) {
    const key = b.key as BadgeKey;
    if (!badgeCatalog.some((c) => c.key === key)) continue;
    const seen = earliest.get(key);
    if (seen === undefined || b.earnedAt < seen) earliest.set(key, b.earnedAt);
  }
  const badges = badgeCatalog
    .filter((b) => earliest.has(b.key))
    .map((b) => ({ key: b.key }));
  const title = profile.title ? (profile.title.key as BadgeKey) : null;
  return (
    <>
      {session ? <OwnProfileRedirect profileId={profile.profileId} /> : null}
      <ProfileView
        name={profile.name}
        title={
          title && badgeCatalog.some((c) => c.key === title)
            ? { key: title, groupName: null }
            : null
        }
        badges={badges}
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
