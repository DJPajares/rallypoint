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
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { ReceiptIcon } from "@phosphor-icons/react/dist/csr/Receipt";
import { UsersThreeIcon } from "@phosphor-icons/react/dist/csr/UsersThree";
import { useAuth } from "./auth-context";
import { useApi } from "./use-api";
import type {
  GroupSummary,
  GroupVisibility,
  Identity,
} from "@rallypoint/domain/contracts";
import { visibilityHelp, visibilityOptions } from "./group-visibility";
import { HomeInvites } from "./invites";
import { GroupSearch } from "./group-search";
import { feeStanding } from "@rallypoint/domain/registration";
import { SplitFee } from "./split-fee";
import type {
  DuesItem,
  SplitClaimDuesItem,
} from "@rallypoint/domain/registration";
import { feeLabel } from "@rallypoint/domain/session";
import { sessionHref, statusLabel } from "@rallypoint/domain/my-sessions";
import type { MySessionRow, MySessions } from "@rallypoint/domain/my-sessions";
import { fromLocal } from "./dates";
import { useFrame } from "./frame";
import {
  Badge,
  buttonClass,
  EmptyState,
  Field,
  ListGroup,
  Notice,
  Pending,
  Pill,
  Segmented,
  SelectField,
  Sheet,
  SpotsMeter,
  Ticket,
} from "@rallypoint/ui";
import type { Tone } from "@rallypoint/ui";
import { DetailPage, StickyActions } from "./ui";
import { useMutation } from "./use-mutation";
import { EarnedBadgeSheet, NextBadge } from "./badges";
import type { BadgesView } from "@rallypoint/domain/badges";
function Redirect({ href }: { href: string; replace?: boolean }) {
  const router = useRouter();
  useEffect(() => {
    router.replace(href);
  }, [router, href]);
  return <Pending>Opening your page…</Pending>;
}
const roleName = (role: GroupSummary["role"]) =>
  role === "admin" ? "Admin" : "Member";
/** The public front door. Signed-in visitors continue to their own Home. */
export function Landing() {
  const { session } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (session) router.replace("/home");
  }, [session, router]);
  return (
    <div className="landing">
      <section className="landing-hero">
        <div className="landing-copy">
          <h1>
            Good company.
            <br />
            <span>Great sessions.</span>
          </h1>
          <p className="rp-lede">
            Bring your people together, then get back to the good part. One
            shared link shows who’s in, what it costs and when to cancel by.
          </p>
          <Link className={buttonClass({ variant: "primary" })} href="/sign-in">
            Find your people
            <ArrowRightIcon size={20} aria-hidden="true" />
          </Link>
          <p className="quiet-note">Sign in once. Keep your group close.</p>
        </div>
        <div className="landing-art" aria-hidden="true">
          <div className="landing-card">
            <span className="rp-kicker">Thursday Pickleball Crew</span>
            <p className="landing-card-title">Thursday night doubles</p>
            <Ticket
              date={{ weekday: "Thu", day: "24", month: "Oct", time: "" }}
            >
              <div className="rp-ticket__time">7:00 – 9:00 pm</div>
              <div className="rp-ticket__meta">Riverside Courts · court 3</div>
            </Ticket>
            <div className="rp-card">
              <SpotsMeter capacity={12} taken={10} />
            </div>
            <span className="landing-join">Join · 2 spots left</span>
          </div>
        </div>
      </section>
      <section className="landing-steps">
        {[
          ["Create", "Publish the time, place, seats and fee."],
          ["Share", "Drop one link in the group chat."],
          ["Show up", "Everyone knows if they’re in or waiting."],
        ].map(([title, body], index) => (
          <div key={title} className="rp-card landing-step">
            <span className="step-number rp-nums">{index + 1}</span>
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
function GroupCard({ group }: { group: GroupSummary }) {
  return (
    <article className="rp-card group-card">
      <span className="rp-icon-tile" aria-hidden="true">
        <UsersThreeIcon size={24} />
      </span>
      <div className="group-card-text">
        <span className="rp-badge">{roleName(group.role)}</span>
        <h2>{group.name}</h2>
      </div>
      <Link href={`/groups/${group.id}`} className={buttonClass()}>
        Open group
        <ArrowRightIcon size={18} aria-hidden="true" />
      </Link>
    </article>
  );
}
export function HomeDashboard() {
  const identity = useApi<Identity>("/api/me");
  const workspace = useApi<{ groups: GroupSummary[] }>("/api/workspace");
  const badges = useApi<BadgesView>("/api/me/badges");
  const { openCreate } = useFrame();
  const groups = workspace.data?.groups ?? [];
  // Anyone can start a session; it no longer needs a group (P-35).
  const canCreate = true;
  return (
    <section className="page home-page">
      <div className="page-head">
        <h1>
          {identity.data
            ? `Hi, ${identity.data.displayName.split(" ")[0]}.`
            : "Welcome back."}
        </h1>
      </div>
      {identity.error ? (
        <Notice retry={identity.retry}>{identity.error}</Notice>
      ) : null}
      <HomeInvites />
      <div className="rp-card rp-card--accent plan-card">
        <div>
          <h2>Plan the next one</h2>
          <p>
            {canCreate
              ? "Set the time and seats, then share one link."
              : "Start a group to publish your first session."}
          </p>
        </div>
        {canCreate ? (
          <button
            type="button"
            className={buttonClass({ variant: "primary" })}
            onClick={openCreate}
          >
            <PlusIcon size={20} weight="bold" aria-hidden="true" />
            New session
          </button>
        ) : (
          <Link
            className={buttonClass({ variant: "primary" })}
            href="/groups/new"
          >
            <PlusIcon size={20} weight="bold" aria-hidden="true" />
            Start a group
          </Link>
        )}
      </div>
      <NextBadge view={badges.data} />
      <EarnedBadgeSheet view={badges.data} />
      <div className="section-head">
        <h2>Your groups</h2>
        {groups.length > 3 ? (
          <Link className={buttonClass({ variant: "link" })} href="/workspace">
            See all {groups.length}
          </Link>
        ) : null}
      </div>
      {workspace.loading ? (
        <Pending>Finding your groups…</Pending>
      ) : workspace.error ? (
        <Notice retry={workspace.retry}>{workspace.error}</Notice>
      ) : groups.length ? (
        <div className="group-grid">
          {groups.slice(0, 3).map((group) => (
            <GroupCard key={group.id} group={group} />
          ))}
        </div>
      ) : (
        <p className="rp-help">
          No groups yet. Start one to run sessions — sessions you join are on
          the Sessions tab.
        </p>
      )}
    </section>
  );
}
// Only states that ask for attention get a pill; being in or organizing is the
// normal case, so it reads quietly under the title instead.
const statusTone: Partial<Record<MySessionRow["status"], Tone>> = {
  waitlisted: "warning",
  requested: "neutral",
  not_accepted: "neutral",
  request_expired: "neutral",
  draft: "neutral",
  cancelled: "danger",
};
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
function MySessionRowLink({ row, past }: { row: MySessionRow; past: boolean }) {
  const time = fromLocal(row.startLocal)?.time;
  const tone = statusTone[row.status];
  const status = statusLabel(row, past);
  return (
    <li className="rp-row">
      <div className="rp-row__line">
        <Link className="rp-row__main my-session" href={sessionHref(row)}>
          <span className="my-session__time rp-nums">{time ?? "TBD"}</span>
          <span className="rp-row__text">
            <span className="rp-row__title">
              {row.title || "Untitled session"}
            </span>
            {/* Status first: a long group name is what gets cut short. */}
            <span className="rp-row__sub">
              {tone ? row.groupName : `${status} · ${row.groupName}`}
            </span>
          </span>
          <span className="rp-row__trail">
            {row.requestCount ? (
              <Pill tone="warning">
                {row.requestCount}{" "}
                {row.requestCount === 1 ? "request" : "requests"}
              </Pill>
            ) : null}
            {tone ? <Pill tone={tone}>{status}</Pill> : null}
            <CaretRightIcon size={16} aria-hidden="true" />
          </span>
        </Link>
      </div>
    </li>
  );
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
      <section key={day.key || "undecided"} className="session-day">
        <h2>{label}</h2>
        <ListGroup>
          {day.rows.map((row) => (
            <MySessionRowLink key={row.id ?? row.slug} row={row} past={past} />
          ))}
        </ListGroup>
      </section>
    );
  });
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
    <section className="page sessions-page">
      <div className="page-head">
        <h1>Sessions</h1>
      </div>
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
                <p className="rp-help">
                  Your latest {past.length} of {pastTotal}.
                </p>
              ) : null}
            </>
          ) : upcoming.length ? (
            <SessionDays rows={upcoming} past={false} today={today} />
          ) : (
            <p className="rp-help session-empty">Nothing coming up.</p>
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
    <li className="rp-card dues-item">
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
      <div className="dues-amount">
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
    <li className="rp-card dues-item">
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
    <section className="page">
      <div className="page-head">
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
          <section className="dues-section" aria-labelledby="dues-owing">
            <h2 id="dues-owing">To pay</h2>
            {owing.length ? (
              <>
                <p className="rp-help">
                  Pay the organizer directly. They mark it paid here; RallyPoint
                  never collects payments.
                </p>
                <ul className="dues-list">
                  {owing.map((d) => (
                    <DuesRow key={d.partyId} item={d} />
                  ))}
                </ul>
              </>
            ) : (
              <p className="rp-help">Nothing to pay right now.</p>
            )}
          </section>
          {estimated.length ? (
            <section className="dues-section" aria-labelledby="dues-estimated">
              <h2 id="dues-estimated">Estimated</h2>
              <ul className="dues-list">
                {estimated.map((c) => (
                  <SplitDuesRow key={c.partyId} item={c} />
                ))}
              </ul>
            </section>
          ) : null}
          {settled.length || settledClaims.length ? (
            <section className="dues-section" aria-labelledby="dues-settled">
              <h2 id="dues-settled">Settled</h2>
              <ul className="dues-list">
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
  return (
    <section className="page">
      <div className="page-head-row">
        <div>
          <h1>Your groups</h1>
        </div>
        <Link className={buttonClass()} href="/groups/new">
          <PlusIcon size={18} weight="bold" aria-hidden="true" />
          Start a group
        </Link>
      </div>
      <GroupSearch />
      {workspace.loading ? (
        <Pending>Finding your groups…</Pending>
      ) : workspace.error ? (
        <Notice retry={workspace.retry}>{workspace.error}</Notice>
      ) : workspace.data?.groups.length ? (
        <div className="group-grid">
          {workspace.data.groups.map((group) => (
            <GroupCard key={group.id} group={group} />
          ))}
        </div>
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
          Start a group to run sessions. Sessions you join are on the Sessions
          tab.
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
      className="form-page"
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
/** Public or Private (P-35): who can find the group and ask to join. */
function GroupVisibilityForm({ group }: { group: GroupSummary }) {
  const [visibility, setVisibility] = useState(group.visibility ?? "public");
  const [saved, setSaved] = useState("");
  const save = useMutation<{ group: { visibility: string } }>(() =>
    setSaved("Saved."),
  );
  return (
    <form
      className="rp-card"
      onSubmit={(e) => {
        e.preventDefault();
        setSaved("");
        save.run(`/api/groups/${group.id}/visibility`, { visibility });
      }}
    >
      <fieldset disabled={save.busy || save.uncertain}>
        <Field
          id="group-visibility"
          label="Who can find it"
          help={visibilityHelp(visibility)}
        >
          <SelectField
            id="group-visibility"
            aria-describedby="group-visibility-help"
            value={visibility}
            onChange={(next) => setVisibility(next as GroupVisibility)}
            options={visibilityOptions}
          />
        </Field>
        <button className={buttonClass()}>
          {save.busy ? "Saving…" : "Save"}
        </button>
        <p role="status" className="rp-help">
          {saved}
        </p>
      </fieldset>
      {save.error ? <Notice>{save.error}</Notice> : null}
      {save.recovery}
    </form>
  );
}
function EditGroupForm({ group }: { group: GroupSummary }) {
  const router = useRouter(),
    [name, setName] = useState(group.name),
    [open, setOpen] = useState(false);
  const save = useMutation<{ group: GroupSummary }>(() =>
    router.push(`/groups/${group.id}`),
  );
  const remove = useMutation<{ archived: boolean }>(() =>
    router.push("/workspace"),
  );
  const working = save.busy || save.uncertain;
  const removing = remove.busy || remove.uncertain;
  return (
    <>
      <div className="page-head">
        <h1>Edit group</h1>
      </div>
      <form
        className="rp-card"
        onSubmit={(e) => {
          e.preventDefault();
          save.run(`/api/groups/${group.id}/rename`, { name });
        }}
      >
        <fieldset disabled={working || removing}>
          <Field id="group-name" label="Group name">
            <input
              id="group-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              required
              autoComplete="organization"
            />
          </Field>
          <StickyActions>
            {/* A disabled fieldset doesn't stop links, so hold this one still while saving. */}
            <Link
              className={buttonClass()}
              href={`/groups/${group.id}`}
              aria-disabled={working || removing || undefined}
              tabIndex={working || removing ? -1 : undefined}
              style={
                working || removing
                  ? { opacity: 0.6, cursor: "not-allowed" }
                  : undefined
              }
              onClick={(e) => {
                if (working || removing) e.preventDefault();
              }}
            >
              Cancel
            </Link>
            <button className={buttonClass({ variant: "primary" })}>
              {save.busy ? "Saving…" : "Save"}
            </button>
          </StickyActions>
        </fieldset>
        {save.error ? <Notice>{save.error}</Notice> : null}
        {save.recovery}
      </form>
      <GroupVisibilityForm group={group} />
      <section className="rp-card" aria-label="Remove group">
        <button
          type="button"
          className={buttonClass()}
          disabled={working || removing}
          onClick={() => setOpen(true)}
        >
          Remove group
        </button>
        <Sheet
          open={open}
          onClose={() => setOpen(false)}
          title="Remove this group?"
        >
          <p>
            It disappears for everyone in it. Past sessions and badges stay.
          </p>
          <div className="fee-actions">
            <button
              type="button"
              className={buttonClass()}
              disabled={removing}
              onClick={() => setOpen(false)}
            >
              Keep it
            </button>
            <button
              type="button"
              className={buttonClass({ variant: "primary" })}
              disabled={removing}
              onClick={() => remove.run(`/api/groups/${group.id}/archive`, {})}
            >
              {remove.busy ? "Removing…" : "Remove group"}
            </button>
          </div>
          {remove.error ? <Notice>{remove.error}</Notice> : null}
          {remove.recovery}
        </Sheet>
        {!open && remove.error ? <Notice>{remove.error}</Notice> : null}
        {!open ? remove.recovery : null}
      </section>
    </>
  );
}
export function NotFound() {
  return (
    <section className="page">
      <EmptyState
        headingLevel={1}
        icon={<span className="rp-nums">404</span>}
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
