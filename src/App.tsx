import { Fragment, useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { ArrowRightIcon } from "@phosphor-icons/react/dist/csr/ArrowRight";
import { CalendarBlankIcon } from "@phosphor-icons/react/dist/csr/CalendarBlank";
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { HouseIcon } from "@phosphor-icons/react/dist/csr/House";
import { SignOutIcon } from "@phosphor-icons/react/dist/csr/SignOut";
import { UsersThreeIcon } from "@phosphor-icons/react/dist/csr/UsersThree";
import {
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router";
import { safeReturnPath, useAuth } from "./auth-context";
import { useApi } from "./use-api";
import type { GroupSummary, Identity } from "./shared/contracts";
import "./App.css";
import { Pending, Notice } from "./ui";
import {
  CreateGroup,
  GroupSessions,
  NewSession,
  SessionEditor,
  SharedSessionPage,
} from "./session-pages";
function PageFocus() {
  const { pathname } = useLocation();
  useEffect(() => {
    const title = document.querySelector<HTMLElement>("main h1");
    if (title) {
      title.tabIndex = -1;
      title.focus({ preventScroll: true });
      document.title = `${title.innerText.replace(/\s+/g, " ").trim()} · RallyPoint`;
    } else document.title = "RallyPoint";
  }, [pathname]);
  return null;
}
function Shell() {
  const { session, client } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  async function signOut() {
    setLeaving(true);
    setError(null);
    const result = await client?.auth.signOut({ scope: "local" });
    if (result?.error) {
      setError("Sign-out did not finish. Please try again.");
      setLeaving(false);
      return;
    }
    sessionStorage.removeItem("rallypoint.returnTo");
    navigate("/", { replace: true });
    setLeaving(false);
  }
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="sidebar">
        <Link to="/" className="brand" aria-label="RallyPoint home">
          <span className="brand-mark">
            r<span>.</span>
          </span>
          <span>RallyPoint</span>
        </Link>
        <nav aria-label="Main navigation">
          <Link to="/" aria-current={pathname === "/" ? "page" : undefined}>
            <HouseIcon size={21} />
            Home
          </Link>
          <Link
            to="/workspace"
            aria-current={
              pathname.startsWith("/workspace") ||
              pathname.startsWith("/groups")
                ? "page"
                : undefined
            }
          >
            <UsersThreeIcon size={21} />
            Your groups
          </Link>
        </nav>
        <div className="sidebar-note">
          <span>↗</span>
          <p>
            Fill the spots,
            <br />
            not the chat.
          </p>
        </div>
        <div className="account-control">
          {session ? (
            <button onClick={() => void signOut()} disabled={leaving}>
              <SignOutIcon size={20} />
              {leaving ? "Signing out…" : "Sign out"}
            </button>
          ) : (
            <Link to="/sign-in">
              <ArrowRightIcon size={20} />
              Sign in
            </Link>
          )}
        </div>
      </aside>
      <div className="content-shell">
        <header className="topbar">
          <span>Good plans. Better company.</span>
          <span>RallyPoint</span>
        </header>
        <main id="main">
          {error ? <Notice>{error}</Notice> : null}
          <PageFocus />
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/sign-in" element={<SignIn />} />
            <Route path="/auth/callback" element={<AuthCallback />} />
            <Route path="/s/:slug" element={<SharedSessionPage />} />
            <Route
              path="/groups/new"
              element={
                <RequireAuth>
                  <CreateGroup />
                </RequireAuth>
              }
            />
            <Route
              path="/groups/:id/sessions/new"
              element={
                <RequireAuth>
                  <NewSession />
                </RequireAuth>
              }
            />
            <Route
              path="/sessions/:id/edit"
              element={
                <RequireAuth>
                  <SessionEditor />
                </RequireAuth>
              }
            />
            <Route
              path="/workspace"
              element={
                <RequireAuth>
                  <Workspace />
                </RequireAuth>
              }
            />
            <Route
              path="/groups/:id"
              element={
                <RequireAuth>
                  <GroupSetup />
                </RequireAuth>
              }
            />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </main>
        <footer>
          <span>Made for getting together.</span>
          <span>One group. One shared link.</span>
        </footer>
      </div>
    </div>
  );
}
function Home() {
  const { session } = useAuth();
  return (
    <div>
      <div className="page-kicker">
        <span className="kicker-line" />A little less organising.
      </div>
      <section className="welcome-grid">
        <div className="welcome-copy">
          <h1>
            Good company.
            <br />
            <span>Great sessions.</span>
          </h1>
          <p className="lede">
            Bring your people together, then get back to the good part.
          </p>
          <Link
            className="button primary"
            to={session ? "/workspace" : "/sign-in"}
          >
            {session ? "Open your groups" : "Find your people"}
            <ArrowRightIcon size={20} />
          </Link>
          <p className="quiet-note">Sign in once. Keep your group close.</p>
        </div>
        <div className="gathering-art" aria-hidden="true">
          <div className="court">
            <span className="court-circle" />
            <span className="court-line" />
            <span className="player p1" />
            <span className="player p2" />
            <span className="player p3" />
            <span className="player p4" />
          </div>
          <span className="art-caption">A place for everyone.</span>
          <div className="art-corner">
            <UsersThreeIcon size={28} weight="duotone" />
          </div>
        </div>
      </section>
      <section>
        <div className="section-heading">
          <h2>Start with your group.</h2>
          <p>The people make the plan.</p>
        </div>
        <div className="empty-inline">
          <span className="icon-tile">
            <CalendarBlankIcon size={30} />
          </span>
          <div>
            <h3>A shared space for your next get-together</h3>
            <p>
              Sign in, start a group and publish the details. One shared link
              keeps everyone on the same page.
            </p>
          </div>
          <span className="pill">Getting started</span>
        </div>
      </section>
    </div>
  );
}
function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading, error } = useAuth();
  const { pathname, search } = useLocation();
  if (loading) return <Pending />;
  if (error) return <Notice>{error}</Notice>;
  return session ? (
    <Fragment key={session.user.id}>{children}</Fragment>
  ) : (
    <Navigate
      to={`/sign-in?next=${encodeURIComponent(pathname + search)}`}
      replace
    />
  );
}
function SignIn() {
  const { config, client, session, loading, error: authError } = useAuth();
  const [params] = useSearchParams();
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
  if (session) return <Navigate to={next} replace />;
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
        <span className="page-kicker">A familiar face is all it takes.</span>
        <h1>
          Your people.
          <br />
          Your next plan.
        </h1>
        <p className="lede">
          Sign in to find your groups and pick up where you left off.
        </p>
        <div className="signin-stamp">
          <UsersThreeIcon size={32} />
          <span>
            Less back-and-forth.
            <br />
            <strong>More showing up.</strong>
          </span>
        </div>
      </div>
      <div className="signin-card">
        <h2>Welcome to RallyPoint</h2>
        <p>Good to have you here.</p>
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
              className="button google"
              onClick={() => void google()}
              disabled={busy || !config.auth?.google}
            >
              Continue with Google
              <ArrowRightIcon size={20} />
            </button>
            {!config.auth?.google ? (
              <p className="field-help">
                Google sign-in has not been connected in this environment.
              </p>
            ) : null}
            {config.auth?.localEmail ? (
              <form
                onSubmit={(event) => void submit(event)}
                className="local-form"
              >
                <div className="form-divider">
                  <span>Local development</span>
                </div>
                <p className="field-help">
                  Use a synthetic account. Your code stays in the local mail
                  inbox.
                </p>
                <label htmlFor="email">Email address</label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  disabled={sent || busy}
                  required
                />
                {sent ? (
                  <>
                    <label htmlFor="code">One-time code</label>
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
                    <p role="status" className="field-help">
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
                <button className="button primary" disabled={busy}>
                  {busy
                    ? "Please wait…"
                    : sent
                      ? "Verify and continue"
                      : "Send local code"}
                  <ArrowRightIcon size={18} />
                </button>
                {sent ? (
                  <button
                    type="button"
                    className="text-button"
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
        <p className="signin-footnote">
          Just looking around? <Link to="/">Back to home</Link>
        </p>
      </div>
    </section>
  );
}
function AuthCallback() {
  const { session, loading, error } = useAuth();
  if (error || (!loading && !session))
    return (
      <Notice>
        Sign-in did not finish. <Link to="/sign-in">Try signing in again</Link>.
      </Notice>
    );
  if (loading) return <Pending>Finishing sign-in…</Pending>;
  const next = safeReturnPath(sessionStorage.getItem("rallypoint.returnTo"));
  return <Navigate to={next} replace />;
}
function Workspace() {
  const identity = useApi<Identity>("/api/me");
  const workspace = useApi<{ groups: GroupSummary[] }>("/api/workspace");
  return (
    <section className="workspace-page">
      <span className="page-kicker">Your corner of RallyPoint</span>
      <h1>Your groups</h1>
      <Link className="button primary" to="/groups/new">
        Start a group ↗
      </Link>
      <p className="lede">
        {identity.data
          ? `Good to see you, ${identity.data.displayName}.`
          : "A good plan starts with your people."}
      </p>
      {identity.error ? (
        <Notice retry={identity.retry}>{identity.error}</Notice>
      ) : null}
      {workspace.loading ? (
        <Pending>Finding your groups…</Pending>
      ) : workspace.error ? (
        <Notice retry={workspace.retry}>{workspace.error}</Notice>
      ) : workspace.data?.groups.length ? (
        <div className="group-list">
          {workspace.data.groups.map((group) => (
            <article key={group.id} className="group-row">
              <span className="icon-tile">
                <UsersThreeIcon size={30} />
              </span>
              <div>
                <span className="role-label">
                  {group.role === "cohost" ? "Co-host" : group.role}
                </span>
                <h2>{group.name}</h2>
                <p>Ready for your next get-together.</p>
              </div>
              {group.role !== "member" ? (
                <Link to={`/groups/${group.id}`} className="button secondary">
                  Open group
                  <ArrowRightIcon size={18} />
                </Link>
              ) : (
                <span className="pill">Member</span>
              )}
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <UsersThreeIcon size={48} weight="light" />
          <h2>No groups yet</h2>
          <p>
            When an organizer adds you to a group, you’ll find it here. Joining
            a session does not automatically make you a group member.
          </p>
          <Link to="/" className="text-button">
            Back to home
            <ArrowRightIcon size={18} />
          </Link>
        </div>
      )}
    </section>
  );
}
function GroupSetup() {
  const { id } = useParams();
  const result = useApi<{ group: GroupSummary }>(`/api/groups/${id}/setup`);
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
    <section className="workspace-page">
      <Link className="back-link" to="/workspace">
        ← Your groups
      </Link>
      {result.loading ? (
        <Pending>Opening your group…</Pending>
      ) : result.error ? (
        <>
          <h1>Group unavailable</h1>
          <Notice retry={result.retry}>{result.error}</Notice>
        </>
      ) : result.data ? (
        <>
          <span className="page-kicker">Your group space</span>
          <h1>{result.data.group.name}</h1>
          <p className="role-confirmation">
            <CheckIcon size={18} />
            You have {result.data.group.role} access.
          </p>
          <GroupSessions group={result.data.group} />
        </>
      ) : null}
    </section>
  );
}
function NotFound() {
  return (
    <section className="empty-state not-found">
      <span className="page-kicker">A little off court</span>
      <h1>That page isn’t here.</h1>
      <p>The link may be incomplete or the page may have moved.</p>
      <Link className="button primary" to="/">
        Back to home
        <ArrowRightIcon size={18} />
      </Link>
    </section>
  );
}
export default function App() {
  return <Shell />;
}
