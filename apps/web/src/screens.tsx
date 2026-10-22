"use client";
import { Fragment, useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
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
import { safeReturnPath, useAuth } from "./auth-context";
import { useApi } from "./use-api";
import type { GroupSummary, Identity } from "@rallypoint/domain/contracts";
import { feeStanding } from "@rallypoint/domain/registration";
import type { DuesItem } from "@rallypoint/domain/registration";
import { feeLabel } from "@rallypoint/domain/session";
import { useCreateTarget, useFrame } from "./frame";
import {
  Badge,
  buttonClass,
  Divider,
  EmptyState,
  Field,
  Notice,
  Pending,
  SpotsMeter,
  Ticket,
} from "@rallypoint/ui";
import { DetailPage } from "./ui";
import { GroupSessions } from "./session-pages";
function Redirect({ href }: { href: string; replace?: boolean }) {
  const router = useRouter();
  useEffect(() => {
    router.replace(href);
  }, [router, href]);
  return <Pending>Opening your page…</Pending>;
}
const roleName = (role: GroupSummary["role"]) =>
  role === "cohost" ? "Co-host" : role[0].toUpperCase() + role.slice(1);
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
      {group.role !== "member" ? (
        <Link href={`/groups/${group.id}`} className={buttonClass()}>
          Open group
          <ArrowRightIcon size={18} aria-hidden="true" />
        </Link>
      ) : (
        <p className="rp-help">Organizers share session links with members.</p>
      )}
    </article>
  );
}
export function HomeDashboard() {
  const identity = useApi<Identity>("/api/me");
  const workspace = useApi<{ groups: GroupSummary[] }>("/api/workspace");
  const { openCreate } = useFrame();
  const groups = workspace.data?.groups ?? [];
  const canCreate = groups.some((group) => group.role !== "member");
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
      <div className="rp-card rp-card--accent plan-card">
        <div>
          <h2>Plan the next one</h2>
          <p>
            {canCreate
              ? "Pick a group, set the time and seats, then share one link."
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
          No groups yet. When an organizer adds you to a group, you’ll find it
          here.
        </p>
      )}
    </section>
  );
}
export function SessionsPage() {
  return (
    <section className="page">
      <div className="page-head">
        <h1>Sessions</h1>
      </div>
      <EmptyState
        icon={<CalendarDotsIcon size={34} />}
        title="Your sessions, all in one place"
        action={
          <Link className={buttonClass()} href="/workspace">
            Go to your groups
          </Link>
        }
      >
        Sessions you’ve joined or host across every group will gather here in a
        later release. For now, find them in each group or open a shared link.
      </EmptyState>
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
        <strong>
          {feeLabel({
            currency: item.fee.currency,
            feeMinor: item.fee.totalMinor,
          })}
        </strong>
        <Badge>{feeStanding(item.fee)}</Badge>
      </div>
    </li>
  );
}
/** The signed-in person's own fees. Organizers record payments per session. */
export function DuesPage() {
  const result = useApi<{ dues: DuesItem[] }>("/api/dues");
  const dues = result.data?.dues ?? [];
  const owing = dues.filter(
    (d) => d.fee.liabilityState === "due" && !d.fee.markedPaid,
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
      ) : !dues.length ? (
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
          {settled.length ? (
            <section className="dues-section" aria-labelledby="dues-settled">
              <h2 id="dues-settled">Settled</h2>
              <ul className="dues-list">
                {settled.map((d) => (
                  <DuesRow key={d.partyId} item={d} />
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </section>
  );
}
export function SignIn() {
  const { config, client, session, loading, error: authError } = useAuth();
  const params = useSearchParams();
  const next = safeReturnPath(params.get("next"));
  const [email, setEmail] = useState("organizer@rallypoint.test");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (sent) input.current?.focus();
  }, [sent]);
  if (session) return <Redirect href={next} replace />;
  async function google() {
    if (!client) return;
    setBusy(true);
    setError(null);
    sessionStorage.setItem("rallypoint.returnTo", next);
    const { error } = await client.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setError("Google sign-in could not be started. Please try again.");
      setBusy(false);
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!client) return;
    setBusy(true);
    setError(null);
    try {
      const { error } = sent
        ? await client.auth.verifyOtp({ email, token: code, type: "email" })
        : await client.auth.signInWithOtp({
            email,
            options: { shouldCreateUser: false },
          });
      if (error) throw error;
      if (!sent) setSent(true);
    } catch {
      setError(
        sent
          ? "That code could not be verified. Check it and try again."
          : "A code could not be created. Check the local services and try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="signin-page">
      <div className="signin-intro">
        <h1>
          Your people.
          <br />
          Your next plan.
        </h1>
        <p className="rp-lede">
          Sign in to find your groups and pick up where you left off.
        </p>
      </div>
      <div className="rp-card signin-card">
        <h2>Welcome to RallyPoint</h2>
        <p className="rp-help">Good to have you here.</p>
        {loading ? (
          <Pending />
        ) : authError ? (
          <Notice>{authError}</Notice>
        ) : !config?.configured ? (
          <Notice>
            Sign-in is not ready yet. Complete the local setup in the README,
            then restart the app.
          </Notice>
        ) : (
          <>
            <button
              className={buttonClass({ variant: "accent", wide: true })}
              onClick={() => void google()}
              disabled={busy || !config.auth?.google}
            >
              Continue with Google
              <ArrowRightIcon size={20} aria-hidden="true" />
            </button>
            {!config.auth?.google ? (
              <p className="rp-help">
                Google sign-in has not been connected in this environment.
              </p>
            ) : null}
            {config.auth?.localEmail ? (
              <form
                onSubmit={(event) => void submit(event)}
                className="local-form"
              >
                <Divider>Local development</Divider>
                <p className="rp-help">
                  Use a synthetic account. Your code stays in the local mail
                  inbox.
                </p>
                <Field id="email" label="Email address">
                  <input
                    id="email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    disabled={sent || busy}
                    required
                  />
                </Field>
                {sent ? (
                  <>
                    <Field id="code" label="One-time code">
                      <input
                        ref={input}
                        id="code"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        pattern="[0-9]{6}"
                        maxLength={6}
                        value={code}
                        onChange={(event) => setCode(event.target.value)}
                        required
                      />
                    </Field>
                    <p role="status" className="rp-help">
                      Open the{" "}
                      <a
                        href="http://127.0.0.1:54324"
                        target="_blank"
                        rel="noreferrer"
                      >
                        local mail inbox
                      </a>{" "}
                      for your code.
                    </p>
                  </>
                ) : null}
                <button
                  className={buttonClass({ variant: "primary", wide: true })}
                  disabled={busy}
                >
                  {busy
                    ? "Please wait…"
                    : sent
                      ? "Verify and continue"
                      : "Send local code"}
                  <ArrowRightIcon size={18} aria-hidden="true" />
                </button>
                {sent ? (
                  <button
                    type="button"
                    className={buttonClass({ variant: "link" })}
                    onClick={() => {
                      setSent(false);
                      setCode("");
                      setError(null);
                    }}
                  >
                    Use a different email
                  </button>
                ) : null}
              </form>
            ) : null}
          </>
        )}
        {error ? <Notice>{error}</Notice> : null}
        <p className="rp-help signin-footnote">
          Just looking around? <Link href="/">Back to home</Link>
        </p>
      </div>
    </section>
  );
}
export function AuthCallback() {
  const { session, loading, error } = useAuth();
  if (error || (!loading && !session))
    return (
      <Notice>
        Sign-in did not finish.{" "}
        <Link href="/sign-in">Try signing in again</Link>.
      </Notice>
    );
  if (loading) return <Pending>Finishing sign-in…</Pending>;
  const next = safeReturnPath(sessionStorage.getItem("rallypoint.returnTo"));
  return <Redirect href={next} replace />;
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
          When an organizer adds you to a group, you’ll find it here. Joining a
          session does not automatically make you a group member.
        </EmptyState>
      )}
    </section>
  );
}
export function GroupSetup() {
  const { id } = useParams<{ id: string }>();
  const result = useApi<{ group: GroupSummary }>(`/api/groups/${id}/setup`);
  useCreateTarget(result.data ? `/groups/${id}/sessions/new` : null);
  useEffect(() => {
    if (!result.loading) {
      const title = document.querySelector<HTMLElement>("main h1");
      if (title) {
        title.tabIndex = -1;
        title.focus({ preventScroll: true });
        document.title = `${title.innerText} · RallyPoint`;
      }
    }
  }, [result.loading, result.data, result.error]);
  return (
    <DetailPage back="/workspace" backLabel="Your groups">
      {result.loading ? (
        <Pending>Opening your group…</Pending>
      ) : result.error ? (
        <>
          <h1>Group unavailable</h1>
          <Notice retry={result.retry}>{result.error}</Notice>
        </>
      ) : result.data ? (
        <>
          <div className="page-head">
            <h1>{result.data.group.name}</h1>
          </div>
          <GroupSessions group={result.data.group} />
        </>
      ) : null}
    </DetailPage>
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
