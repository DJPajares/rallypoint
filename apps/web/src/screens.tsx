"use client";
import { Fragment, useEffect, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import {
  usePathname,
  useParams,
  useRouter,
  useSearchParams,
} from "next/navigation";
import { ArrowRightIcon } from "@phosphor-icons/react/dist/csr/ArrowRight";
import { CalendarDotsIcon } from "@phosphor-icons/react/dist/csr/CalendarDots";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { ReceiptIcon } from "@phosphor-icons/react/dist/csr/Receipt";
import { UsersThreeIcon } from "@phosphor-icons/react/dist/csr/UsersThree";
import { useAuth } from "./auth-context";
import { useApi } from "./use-api";
import type { GroupSummary, Identity } from "@rallypoint/domain/contracts";
import { EditGroupForm } from "./group-edit";
import { HomeInvites } from "./invites";
import { feeStanding } from "@rallypoint/domain/registration";
import { SplitFee } from "./split-fee";
import type {
  DuesItem,
  SplitClaimDuesItem,
} from "@rallypoint/domain/registration";
import { feeLabel } from "@rallypoint/domain/session";
import type { MySessionRow, MySessions } from "@rallypoint/domain/my-sessions";
import { fromLocal } from "./dates";
import { useFrame } from "./frame";
import {
  Badge,
  buttonClass,
  cx,
  EmptyState,
  ListGroup,
  Notice,
  Pending,
  Segmented,
  SpotsMeter,
  Ticket,
} from "@rallypoint/ui";
import { DetailPage } from "./ui";
import { GroupRow, SessionRow, TabHero, UpNext } from "./tab-parts";
import { EarnedBadgeSheet, NextBadge } from "./badges";
import type { BadgesView } from "@rallypoint/domain/badges";
function Redirect({ href }: { href: string; replace?: boolean }) {
  const router = useRouter();
  useEffect(() => {
    router.replace(href);
  }, [router, href]);
  return <Pending>Opening your page…</Pending>;
}
/** The public front door. Signed-in visitors continue to their own Home. */
export function Landing() {
  const { session } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (session) router.replace("/home");
  }, [session, router]);
  return (
    <div>
      <section className="grid items-center gap-8 desk:min-h-[56dvh] desk:grid-cols-[1.2fr_1fr]">
        <div className="[&_h1]:mb-4 [&_h1]:text-display-lg [&_h1]:leading-[0.98] [&_h1_span]:text-text-muted">
          <h1>
            Good company.
            <br />
            <span>Great sessions.</span>
          </h1>
          <p className="max-w-reading text-lg text-text-muted">
            Bring your people together, then get back to the good part. One
            shared link shows who’s in, what it costs and when to cancel by.
          </p>
          <Link
            className={cx(buttonClass({ variant: "primary" }), "mt-2")}
            href="/sign-in"
          >
            Find your people
            <ArrowRightIcon size={20} aria-hidden="true" />
          </Link>
          <p className="mt-6 text-sm text-text-muted">
            Sign in once. Keep your group close.
          </p>
        </div>
        <div className="flex justify-center" aria-hidden="true">
          <div className="grid w-[min(360px,100%)] -rotate-[1.5deg] gap-3 rounded-xl border border-border bg-surface p-5 shadow-lg">
            <span className="m-0 block text-sm font-semibold text-text-muted">
              Thursday Pickleball Crew
            </span>
            <p className="-mt-1 mb-0 font-heading text-2xl leading-tight font-bold tracking-tight">
              Thursday night doubles
            </p>
            <Ticket
              date={{ weekday: "Thu", day: "24", month: "Oct", time: "" }}
            >
              <div className="font-semibold tabular-nums">7:00 – 9:00 pm</div>
              <div className="text-sm text-text-muted">
                Riverside Courts · court 3
              </div>
            </Ticket>
            <div className="rounded-lg border border-border bg-surface p-3">
              <SpotsMeter capacity={12} taken={10} />
            </div>
            <span className="block rounded-full bg-action p-3 text-center font-bold text-on-action">
              Join · 2 spots left
            </span>
          </div>
        </div>
      </section>
      <section className="mt-12 grid gap-3 md:grid-cols-3">
        {[
          ["Create", "Publish the time, place, seats and fee."],
          ["Share", "Drop one link in the group chat."],
          ["Show up", "Everyone knows if they’re in or waiting."],
        ].map(([title, body], index) => (
          <div
            key={title}
            className="rounded-lg border border-border bg-surface p-5 [&_h2]:mt-2 [&_h2]:mb-1 [&_h2]:text-xl [&_p]:m-0 [&_p]:text-text-muted"
          >
            <span className="inline-flex size-8 items-center justify-center rounded-full bg-stub font-bold text-on-stub tabular-nums">
              {index + 1}
            </span>
            <h2>{title}</h2>
            <p>{body}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading, error } = useAuth();
  const pathname = usePathname();
  const params = useSearchParams();
  const search = params.toString() ? `?${params}` : "";
  if (loading) return <Pending />;
  if (error) return <Notice>{error}</Notice>;
  return session ? (
    <Fragment key={session.user.id}>{children}</Fragment>
  ) : (
    <Redirect
      href={`/sign-in?next=${encodeURIComponent(pathname + search)}`}
      replace
    />
  );
}
const DAY = 86_400_000;
export function HomeDashboard() {
  const identity = useApi<Identity>("/api/me");
  const workspace = useApi<{ groups: GroupSummary[] }>("/api/workspace");
  const badges = useApi<BadgesView>("/api/me/badges");
  const sessions = useApi<MySessions>("/api/me/sessions");
  const { openCreate } = useFrame();
  // Read once: Home's "this week" and "starts in" don't need to tick.
  const [now] = useState(() => Date.now());
  const groups = workspace.data?.groups ?? [];
  // Up next is a session you're going to: in, hosting or waiting for a place.
  const going = goingTo(sessions.data?.upcoming ?? []);
  const next = going[0];
  const week = going
    .slice(1)
    .filter((row) => row.startsAt && Date.parse(row.startsAt) - now < 7 * DAY)
    .slice(0, 4);
  const thisWeek = going.filter(
    (row) => row.startsAt && Date.parse(row.startsAt) - now < 7 * DAY,
  ).length;
  const dateLine = new Intl.DateTimeFormat("en", {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(now);
  return (
    <section className="mx-auto grid max-w-form content-start gap-5">
      <TabHero
        title={
          identity.data
            ? `Hi, ${identity.data.displayName.split(" ")[0]}`
            : "Welcome back"
        }
        summary={
          thisWeek
            ? `${dateLine} · ${thisWeek} ${thisWeek === 1 ? "session" : "sessions"} this week`
            : dateLine
        }
        // With nothing coming up, the empty card offers New session instead.
        onCreate={next ? openCreate : undefined}
      />
      {identity.error ? (
        <Notice retry={identity.retry}>{identity.error}</Notice>
      ) : null}
      {sessions.loading ? (
        <Pending>Finding what's next…</Pending>
      ) : sessions.error ? (
        <Notice retry={sessions.retry}>{sessions.error}</Notice>
      ) : next ? (
        <UpNext row={next} now={now} />
      ) : (
        <div className="grid grid-cols-[auto_1fr_auto] items-center gap-5 rounded-xl border border-border bg-surface p-6 shadow-sm max-[520px]:grid-cols-[auto_1fr] max-[520px]:gap-4 max-[520px]:p-5">
          <CalendarDotsIcon size={30} aria-hidden="true" />
          <div>
            <h2>Nothing coming up</h2>
            <p>Start a session, or open a group to see what it has planned.</p>
          </div>
          <button type="button" className={buttonClass()} onClick={openCreate}>
            <PlusIcon size={18} weight="bold" aria-hidden="true" />
            New session
          </button>
        </div>
      )}
      <HomeInvites />
      {week.length ? (
        <section className="grid gap-3" aria-labelledby="home-week">
          <div className="flex items-baseline justify-between gap-3 [&_h2]:m-0 [&_h2]:text-lg">
            <h2 id="home-week">This week</h2>
            <Link className={buttonClass({ variant: "link" })} href="/sessions">
              All sessions
            </Link>
          </div>
          <ListGroup>
            {week.map((row) => (
              <SessionRow key={row.slug} row={row} past={false} speakDate />
            ))}
          </ListGroup>
        </section>
      ) : null}
      <NextBadge view={badges.data} />
      <EarnedBadgeSheet view={badges.data} />
      <section className="grid gap-3" aria-labelledby="home-groups">
        <div className="flex items-baseline justify-between gap-3 [&_h2]:m-0 [&_h2]:text-lg">
          <h2 id="home-groups">Your groups</h2>
          {groups.length > 3 ? (
            <Link
              className={buttonClass({ variant: "link" })}
              href="/workspace"
            >
              See all {groups.length}
            </Link>
          ) : null}
        </div>
        {workspace.loading ? (
          <Pending>Finding your groups…</Pending>
        ) : workspace.error ? (
          <Notice retry={workspace.retry}>{workspace.error}</Notice>
        ) : (
          <ListGroup>
            {groups.slice(0, 3).map((group) => (
              <GroupRow key={group.id} group={group} />
            ))}
            {groups.length ? null : <StartGroupRow />}
          </ListGroup>
        )}
      </section>
    </section>
  );
}
/** The quiet way to start a group, as the last row of a groups list. */
function StartGroupRow() {
  return (
    <li className="border-t border-border first:border-t-0">
      <div className="flex min-h-13 items-center gap-2">
        <Link
          className="flex min-h-13 min-w-0 flex-1 items-center gap-3 border-0 bg-transparent py-2 pr-3 pl-3 text-left text-inherit no-underline [font:inherit] [a&]:hover:bg-surface-sunken [button&]:cursor-pointer [button&]:hover:bg-surface-sunken focus-visible:-outline-offset-3"
          href="/groups/new"
        >
          <span
            className="grid aspect-square w-11 flex-none place-items-center rounded-md border border-dashed border-border-strong text-text-muted"
            aria-hidden="true"
          >
            <PlusIcon size={20} weight="bold" />
          </span>
          <span className="grid min-w-0 flex-1">
            <span className="truncate font-semibold">Start a group</span>
            <span className="truncate text-sm text-text-muted">
              A list of people you play with, public or private.
            </span>
          </span>
        </Link>
      </div>
    </li>
  );
}
/** A calendar day as "YYYY-MM-DD", the same shape as a row's startLocal. */
const dayKey = (date: Date) =>
  [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
/**
 * "Today", "Tomorrow" (upcoming only), "Yesterday" (past only) or "Sun, Oct 25"
 * for a session's own day. A session elsewhere can end on what is still
 * tomorrow here, and "Tomorrow" under Past would read wrong.
 */
function dayLabel(key: string, today: string, past: boolean) {
  if (!key) return "Date to be decided";
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const [ty, tm, td] = today.split("-").map(Number);
  const offset = Math.round(
    (date.getTime() - Date.UTC(ty, tm - 1, td)) / 86_400_000,
  );
  if (offset === 0) return "Today";
  if (offset === 1 && !past) return "Tomorrow";
  if (offset === -1 && past) return "Yesterday";
  return new Intl.DateTimeFormat("en", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
    year: y === ty ? undefined : "numeric",
  }).format(date);
}
/**
 * Rows gathered under one heading per day, in the wall-clock order the page
 * shows: sessions in other timezones would otherwise interleave. Undecided
 * dates go last.
 */
function byDay(rows: MySessionRow[], newestFirst: boolean) {
  const sorted = [...rows].sort((a, b) =>
    !a.startLocal || !b.startLocal
      ? Number(!a.startLocal) - Number(!b.startLocal)
      : a.startLocal.localeCompare(b.startLocal) * (newestFirst ? -1 : 1),
  );
  const days = new Map<string, MySessionRow[]>();
  for (const row of sorted) {
    const key = row.startLocal.slice(0, 10);
    days.set(key, [...(days.get(key) ?? []), row]);
  }
  return [...days].map(([key, rows]) => ({ key, rows }));
}
function SessionDays({
  rows,
  past,
  today,
}: {
  rows: MySessionRow[];
  past: boolean;
  today: string;
}) {
  return byDay(rows, past).map((day) => {
    const label = dayLabel(day.key, today, past);
    return (
      <section
        key={day.key || "undecided"}
        className="[&_h2]:sticky [&_h2]:top-(--safe-top) [&_h2]:z-1 [&_h2]:m-0 [&_h2]:bg-bg [&_h2]:px-1 [&_h2]:py-2 [&_h2]:text-lg md:[&_h2]:top-topbar"
      >
        <h2>{label}</h2>
        <ListGroup>
          {day.rows.map((row) => (
            <SessionRow
              key={row.id ?? row.slug}
              row={row}
              past={past}
              today={!past && day.key === today}
            />
          ))}
        </ListGroup>
      </section>
    );
  });
}
/**
 * Sessions you're going to: in, hosting or waiting for a place, published.
 * Drafts, cancellations and requests don't count as coming up.
 */
const goingTo = (rows: MySessionRow[]) =>
  rows.filter(
    (row) =>
      row.state === "published" &&
      (row.status === "in" ||
        row.status === "organizing" ||
        row.status === "waitlisted"),
  );
/** "3 coming up · next today, 7:00 PM"; nothing when none are coming up. */
function sessionsSummary(upcoming: MySessionRow[], today: string) {
  const going = byDay(goingTo(upcoming), false).flatMap((day) => day.rows);
  const next = going.find((row) => row.startLocal);
  if (!next) return undefined;
  const day = dayLabel(next.startLocal.slice(0, 10), today, false);
  const time = fromLocal(next.startLocal)?.time;
  const when = [
    day === "Today" || day === "Tomorrow" ? day.toLowerCase() : day,
    time,
  ]
    .filter(Boolean)
    .join(", ");
  return `${going.length} coming up · next ${when}`;
}
export function SessionsPage() {
  const sessions = useApi<MySessions>("/api/me/sessions");
  const { openCreate } = useFrame();
  const [view, setView] = useState<"upcoming" | "past">("upcoming");
  // The device's own date, read once; it only decides "Today" and "Tomorrow".
  const [today] = useState(() => dayKey(new Date()));
  // Anyone can start a session; it no longer needs a group (P-35).
  const canCreate = true;
  const upcoming = sessions.data?.upcoming ?? [];
  const past = sessions.data?.past ?? [];
  const pastTotal = sessions.data?.pastTotal ?? 0;
  const showing = pastTotal > 0 ? view : "upcoming";
  return (
    <section className="mx-auto grid max-w-form content-start gap-5 **:data-[slot=segmented]:max-w-80">
      <TabHero
        title="Sessions"
        summary={sessions.data ? sessionsSummary(upcoming, today) : undefined}
        onCreate={upcoming.length || pastTotal ? openCreate : undefined}
      />
      {sessions.loading ? (
        <Pending>Finding your sessions…</Pending>
      ) : sessions.error ? (
        <Notice retry={sessions.retry}>{sessions.error}</Notice>
      ) : !upcoming.length && !pastTotal ? (
        <EmptyState
          icon={<CalendarDotsIcon size={34} />}
          title="Nothing coming up"
          action={
            canCreate ? (
              <button
                type="button"
                className={buttonClass({ variant: "primary" })}
                onClick={openCreate}
              >
                <PlusIcon size={20} weight="bold" aria-hidden="true" />
                New session
              </button>
            ) : undefined
          }
        >
          Sessions you join or run will show here.
        </EmptyState>
      ) : (
        <>
          {pastTotal > 0 ? (
            <Segmented
              label="Show sessions"
              options={[
                { value: "upcoming", label: "Upcoming" },
                { value: "past", label: "Past" },
              ]}
              value={showing}
              onChange={setView}
            />
          ) : null}
          {showing === "past" ? (
            <>
              <SessionDays rows={past} past today={today} />
              {past.length < pastTotal ? (
                <p className="mt-1 mb-0 text-sm text-text-muted">
                  Your latest {past.length} of {pastTotal}.
                </p>
              ) : null}
            </>
          ) : upcoming.length ? (
            <SessionDays rows={upcoming} past={false} today={today} />
          ) : (
            <p className="mt-6 mb-0 text-sm text-text-muted">
              Nothing coming up.
            </p>
          )}
        </>
      )}
    </section>
  );
}
function DuesRow({ item }: { item: DuesItem }) {
  // Times read in the session's own local time, never with a zone label (D-13).
  const date = new Intl.DateTimeFormat("en", {
    timeZone: item.session.timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(item.session.startsAt));
  return (
    <li className="rounded-lg border border-border bg-surface p-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 *:[div]:grid *:[div]:gap-0.5 [&>div:first-child]:min-w-0 [&>div:first-child]:flex-[1_1_0] [&_span]:text-sm [&_span]:text-text-muted">
      <div>
        <Link href={`/s/${item.session.slug}`}>
          <strong>{item.session.title}</strong>
        </Link>
        <span>
          {date}
          {item.session.state === "cancelled" ? " · Cancelled" : ""}
          {item.partyState === "withdrawn" ? " · You withdrew" : ""}
          {item.seats === 2 ? " · You and your guest" : ""}
        </span>
      </div>
      <div className="justify-items-end tabular-nums">
        {/* A released spot's fee was dropped: no amount, so nothing looks owed. */}
        {item.fee.liabilityState === "released_unpaid" ? null : (
          <strong>
            {feeLabel({
              currency: item.fee.currency,
              feeMinor: item.fee.totalMinor,
            })}
          </strong>
        )}
        <Badge>{feeStanding(item.fee)}</Badge>
      </div>
    </li>
  );
}
function SplitDuesRow({ item }: { item: SplitClaimDuesItem }) {
  return (
    <li className="rounded-lg border border-border bg-surface p-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 *:[div]:grid *:[div]:gap-0.5 [&>div:first-child]:min-w-0 [&>div:first-child]:flex-[1_1_0] [&_span]:text-sm [&_span]:text-text-muted">
      <div>
        <Link href={`/s/${item.session.slug}`}>
          <strong>{item.session.title}</strong>
        </Link>
        <span>
          {item.seats === 2 ? "You and your guest" : "Your party"}
          {item.partyState === "withdrawn" ? " · You withdrew" : ""}
        </span>
      </div>
      <SplitFee summary={item.split} claim={item.splitClaim} />
    </li>
  );
}
/** The signed-in person's own fees. Organizers record payments per session. */
export function DuesPage() {
  const result = useApi<{
    dues: DuesItem[];
    splitClaims: SplitClaimDuesItem[];
  }>("/api/dues");
  const claims = result.data?.splitClaims ?? [];
  const estimated = claims.filter(
    (c) =>
      c.split.phase === "estimating" &&
      c.splitClaim.eligible &&
      !c.splitClaim.waived,
  );
  const settledClaims = claims.filter((c) => !estimated.includes(c));
  const dues = result.data?.dues ?? [];
  const owing = dues.filter(
    (d) =>
      d.fee.liabilityState === "due" &&
      !d.fee.markedPaid &&
      d.fee.totalMinor > 0,
  );
  const settled = dues.filter((d) => !owing.includes(d));
  return (
    <section>
      <div className="mb-4">
        <h1>Dues</h1>
      </div>
      {result.loading ? (
        <Pending>Loading your dues…</Pending>
      ) : result.error ? (
        <Notice retry={result.retry}>{result.error}</Notice>
      ) : !dues.length && !claims.length ? (
        <EmptyState
          icon={<ReceiptIcon size={34} />}
          title="Nothing to pay"
          action={null}
        >
          Fees for sessions you join show up here. RallyPoint never collects
          payments.
        </EmptyState>
      ) : (
        <>
          <section
            className="grid gap-3 [&_h2]:m-0 [&_h2]:text-xl"
            aria-labelledby="dues-owing"
          >
            <h2 id="dues-owing">To pay</h2>
            {owing.length ? (
              <>
                <p className="mt-1 mb-0 text-sm text-text-muted">
                  Pay the organizer directly. They mark it paid here; RallyPoint
                  never collects payments.
                </p>
                <ul className="m-0 grid list-none gap-3 p-0">
                  {owing.map((d) => (
                    <DuesRow key={d.partyId} item={d} />
                  ))}
                </ul>
              </>
            ) : (
              <p className="mt-1 mb-0 text-sm text-text-muted">
                Nothing to pay right now.
              </p>
            )}
          </section>
          {estimated.length ? (
            <section
              className="grid gap-3 [&_h2]:m-0 [&_h2]:text-xl"
              aria-labelledby="dues-estimated"
            >
              <h2 id="dues-estimated">Estimated</h2>
              <ul className="m-0 grid list-none gap-3 p-0">
                {estimated.map((c) => (
                  <SplitDuesRow key={c.partyId} item={c} />
                ))}
              </ul>
            </section>
          ) : null}
          {settled.length || settledClaims.length ? (
            <section
              className="grid gap-3 [&_h2]:m-0 [&_h2]:text-xl"
              aria-labelledby="dues-settled"
            >
              <h2 id="dues-settled">Settled</h2>
              <ul className="m-0 grid list-none gap-3 p-0">
                {settled.map((d) => (
                  <DuesRow key={d.partyId} item={d} />
                ))}
                {settledClaims.map((c) => (
                  <SplitDuesRow key={c.partyId} item={c} />
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </section>
  );
}
export function Workspace() {
  const workspace = useApi<{ groups: GroupSummary[] }>("/api/workspace");
  const groups = workspace.data?.groups ?? [];
  const admin = groups.filter((group) => group.role === "admin").length;
  return (
    <section className="mx-auto grid max-w-form content-start gap-5">
      <TabHero
        title="Your groups"
        summary={
          groups.length
            ? `${groups.length} ${groups.length === 1 ? "group" : "groups"}${admin ? ` · you run ${admin}` : ""}`
            : undefined
        }
      />
      {workspace.loading ? (
        <Pending>Finding your groups…</Pending>
      ) : workspace.error ? (
        <Notice retry={workspace.retry}>{workspace.error}</Notice>
      ) : groups.length ? (
        <ListGroup>
          {groups.map((group) => (
            <GroupRow key={group.id} group={group} />
          ))}
          <StartGroupRow />
        </ListGroup>
      ) : (
        <EmptyState
          icon={<UsersThreeIcon size={34} />}
          title="No groups yet"
          action={
            <Link
              href="/groups/new"
              className={buttonClass({ variant: "primary" })}
            >
              Start a group
            </Link>
          }
        >
          A group is a list of people you play with. Sessions you join are on
          the Sessions tab.
        </EmptyState>
      )}
    </section>
  );
}
/** Focus the page title and name the tab once the page has something to show. */
function useHeadingFocus(loading: boolean, data: unknown, error: unknown) {
  useEffect(() => {
    if (loading) return;
    const title = document.querySelector<HTMLElement>("main h1");
    if (title) {
      title.tabIndex = -1;
      title.focus({ preventScroll: true });
      document.title = `${title.innerText} · RallyPoint`;
    }
  }, [loading, data, error]);
}
/** Owner only: rename the group or remove it. */
export function EditGroup() {
  const { id } = useParams<{ id: string }>();
  const result = useApi<{ group: GroupSummary }>(`/api/groups/${id}/setup`);
  useHeadingFocus(result.loading, result.data, result.error);
  const group = result.data?.group;
  return (
    <DetailPage
      back={`/groups/${id}`}
      backLabel={group?.name ?? "Your group"}
      className="mx-auto max-w-form"
    >
      {result.loading ? (
        <Pending>Opening your group…</Pending>
      ) : result.error ? (
        <>
          <h1>Group unavailable</h1>
          <Notice retry={result.retry}>{result.error}</Notice>
        </>
      ) : group && group.role !== "admin" ? (
        <>
          <h1>Group unavailable</h1>
          <Notice>Only the group’s admin can edit it.</Notice>
        </>
      ) : group ? (
        <EditGroupForm group={group} />
      ) : null}
    </DetailPage>
  );
}
export function NotFound() {
  return (
    <section>
      <EmptyState
        headingLevel={1}
        icon={<span className="tabular-nums">404</span>}
        title="That page isn’t here."
        action={
          <Link className={buttonClass({ variant: "primary" })} href="/">
            Back to home
            <ArrowRightIcon size={18} aria-hidden="true" />
          </Link>
        }
      >
        The link may be incomplete or the page may have moved.
      </EmptyState>
    </section>
  );
}
