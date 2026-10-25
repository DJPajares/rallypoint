"use client";
// Email and password sign-up, sign-in and reset through Supabase Auth (D-22).
// Supabase sends the confirmation and reset links; every link returns to
// /auth/callback, and the page to go back to is remembered on this device.
import { useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRightIcon } from "@phosphor-icons/react/dist/csr/ArrowRight";
import { EyeIcon } from "@phosphor-icons/react/dist/csr/Eye";
import { EyeSlashIcon } from "@phosphor-icons/react/dist/csr/EyeSlash";
import type { AuthError } from "@supabase/supabase-js";
import { hidesAccount, isRecoverySession } from "@rallypoint/domain/auth-links";
import type { LinkError } from "@rallypoint/domain/auth-links";
import { buttonClass, Divider, Field, Notice, Pending } from "@rallypoint/ui";
import { safeReturnPath, useAuth } from "./auth-context";
import { rememberReturnPath, redirectUrl, takeReturnPath } from "./return-path";

const minPassword = 8;
const resendSeconds = 30;

/** The page to return to, from ?next=, carried between the auth pages. */
function useNext() {
  return safeReturnPath(useSearchParams().get("next"));
}
const withNext = (path: string, next: string) =>
  next === "/workspace" ? path : `${path}?next=${encodeURIComponent(next)}`;

/** Go once, even when React runs the effect twice in development. */
function useGo(target: (() => string) | null) {
  const router = useRouter();
  const gone = useRef(false);
  useEffect(() => {
    if (!target || gone.current) return;
    gone.current = true;
    router.replace(target());
  }, [target, router]);
}

/** Seconds left before another email may be asked for, and a way to start. */
function useCooldown(): [number, () => void] {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!left) return;
    const timer = setTimeout(() => setLeft(left - 1), 1000);
    return () => clearTimeout(timer);
  }, [left]);
  return [left, () => setLeft(resendSeconds)];
}

/** Network and rate-limit failures read the same on every form. */
function commonError(error: AuthError) {
  if (error.status === 429 || error.code?.startsWith("over_"))
    return "Too many tries. Wait a minute and try again.";
  if (!error.status || error.status >= 500)
    return "That didn’t go through. Check your connection and try again.";
  return null;
}

function AuthLayout({
  intro,
  title,
  children,
}: {
  intro?: { title: ReactNode; lede: string };
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="signin-page">
      {intro ? (
        <div className="signin-intro">
          <h1>{intro.title}</h1>
          <p className="rp-lede">{intro.lede}</p>
        </div>
      ) : null}
      <div className="rp-card signin-card">
        {intro ? <h2>{title}</h2> : <h1>{title}</h1>}
        {children}
      </div>
    </section>
  );
}

/** Shown in place of a form when sign-in can't be offered here. */
function Unavailable() {
  const { config, loading, error } = useAuth();
  if (loading) return <Pending />;
  if (error) return <Notice>{error}</Notice>;
  if (!config?.configured)
    return (
      <Notice>
        Sign-in is not ready yet. Complete the local setup in the README, then
        restart the app.
      </Notice>
    );
  if (!config.auth?.password)
    return <Notice>Signing in with email isn’t available here yet.</Notice>;
  return null;
}

function LocalNote() {
  const { config } = useAuth();
  if (!config?.auth?.localEmail) return null;
  return (
    <>
      <Divider>Local development</Divider>
      <p className="rp-help">
        Use a synthetic account. Confirmation and reset emails go to the{" "}
        <a href="http://127.0.0.1:54324" target="_blank" rel="noreferrer">
          local mail inbox
        </a>
        .
      </p>
    </>
  );
}

function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: "new-password" | "current-password";
}) {
  const [shown, setShown] = useState(false);
  const fresh = autoComplete === "new-password";
  return (
    <Field
      id={id}
      label={label}
      help={fresh ? `At least ${minPassword} characters.` : undefined}
    >
      <div className="rp-control rp-affix password-control">
        <input
          id={id}
          className="rp-bare rp-affix__input"
          type={shown ? "text" : "password"}
          autoComplete={autoComplete}
          minLength={fresh ? minPassword : undefined}
          aria-describedby={fresh ? `${id}-help` : undefined}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          required
        />
        <button
          type="button"
          className="password-toggle"
          aria-pressed={shown}
          aria-label={shown ? "Hide password" : "Show password"}
          onClick={() => setShown((value) => !value)}
        >
          {shown ? (
            <EyeSlashIcon size={20} aria-hidden="true" />
          ) : (
            <EyeIcon size={20} aria-hidden="true" />
          )}
        </button>
      </div>
    </Field>
  );
}

function EmailField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field id="email" label="Email address">
      <input
        id="email"
        type="email"
        autoComplete="email"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required
      />
    </Field>
  );
}

export function SignIn() {
  const { config, client, session } = useAuth();
  const next = useNext();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<
    "credentials" | "unconfirmed" | string | null
  >(null);
  const [resent, setResent] = useState(false);
  const [cooldown, startCooldown] = useCooldown();
  useEffect(() => rememberReturnPath(next), [next]);
  // Signing in updates the session; this sends them on, whichever way it came.
  useGo(session ? takeReturnPath : null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!client) return;
    setBusy(true);
    setProblem(null);
    setResent(false);
    const { error } = await client.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (!error) return;
    setProblem(
      error.code === "invalid_credentials"
        ? "credentials"
        : error.code === "email_not_confirmed"
          ? "unconfirmed"
          : (commonError(error) ?? "Sign-in didn’t finish. Please try again."),
    );
  }
  async function resend() {
    if (!client) return;
    startCooldown();
    const { error } = await client.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: redirectUrl() },
    });
    if (error) setProblem(commonError(error) ?? "unconfirmed");
    else setResent(true);
  }
  async function google() {
    if (!client) return;
    setBusy(true);
    const { error } = await client.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: redirectUrl() },
    });
    if (error) {
      setProblem("Google sign-in could not be started. Please try again.");
      setBusy(false);
    }
  }
  return (
    <AuthLayout
      intro={{
        title: (
          <>
            Your people.
            <br />
            Your next plan.
          </>
        ),
        lede: "Sign in to find your groups and pick up where you left off.",
      }}
      title="Sign in"
    >
      <Unavailable />
      {config?.auth?.google ? (
        <button
          className={buttonClass({ variant: "accent", wide: true })}
          onClick={() => void google()}
          disabled={busy}
        >
          Continue with Google
          <ArrowRightIcon size={20} aria-hidden="true" />
        </button>
      ) : null}
      {config?.auth?.password ? (
        <form className="auth-form" onSubmit={(event) => void submit(event)}>
          <LocalNote />
          <EmailField value={email} onChange={setEmail} />
          <PasswordField
            id="password"
            label="Password"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
          />
          <Link
            className="auth-aside"
            href={withNext("/forgot-password", next)}
          >
            Forgot password?
          </Link>
          {problem === "credentials" ? (
            <Notice>
              That email and password don’t match.{" "}
              <Link href={withNext("/forgot-password", next)}>
                Forgot password?
              </Link>
            </Notice>
          ) : problem === "unconfirmed" ? (
            <Notice tone="warning">
              Confirm your email first. Check your inbox.{" "}
              <button
                type="button"
                className={buttonClass({ variant: "link" })}
                onClick={() => void resend()}
                disabled={cooldown > 0}
              >
                {cooldown ? `Resend in ${cooldown}s` : "Resend email"}
              </button>
            </Notice>
          ) : problem ? (
            <Notice>{problem}</Notice>
          ) : null}
          {resent ? (
            <p role="status" className="rp-help">
              Sent. Check your inbox.
            </p>
          ) : null}
          <button
            className={buttonClass({ variant: "primary", wide: true })}
            disabled={busy || !client}
          >
            {busy ? "Signing in…" : "Sign in"}
            <ArrowRightIcon size={18} aria-hidden="true" />
          </button>
        </form>
      ) : null}
      <p className="rp-help signin-footnote">
        New here?{" "}
        <Link href={withNext("/sign-up", next)}>Create an account</Link>
      </p>
    </AuthLayout>
  );
}

export function SignUp() {
  const { config, client, session } = useAuth();
  const next = useNext();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [cooldown, startCooldown] = useCooldown();
  useEffect(() => rememberReturnPath(next), [next]);
  // A project without email confirmation signs them in at once.
  useGo(session ? takeReturnPath : null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!client) return;
    setBusy(true);
    setProblem(null);
    const { error } = await client.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectUrl(),
        data: { full_name: name.trim() },
      },
    });
    setBusy(false);
    // Supabase answers the same for new and existing emails, and so do we.
    if (!error || hidesAccount(error.code)) {
      setSent(true);
      startCooldown();
      return;
    }
    setProblem(
      error.code === "weak_password"
        ? "Choose a longer password."
        : (commonError(error) ?? "Sign-up didn’t finish. Please try again."),
    );
  }
  async function resend() {
    if (!client) return;
    startCooldown();
    const { error } = await client.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: redirectUrl() },
    });
    setProblem(error && !hidesAccount(error.code) ? commonError(error) : null);
  }
  if (sent)
    return (
      <AuthLayout title="Check your email">
        <p role="status">
          We sent a link to <strong>{email}</strong>. Tap it to finish creating
          your account.
        </p>
        <p className="rp-help">
          Already have an account?{" "}
          <Link href={withNext("/sign-in", next)}>Sign in</Link> or{" "}
          <Link href={withNext("/forgot-password", next)}>
            reset your password
          </Link>
          .
        </p>
        {problem ? <Notice>{problem}</Notice> : null}
        <div className="auth-actions">
          <button
            type="button"
            className={buttonClass()}
            onClick={() => void resend()}
            disabled={cooldown > 0}
          >
            {cooldown ? `Resend in ${cooldown}s` : "Resend email"}
          </button>
          <button
            type="button"
            className={buttonClass({ variant: "link" })}
            onClick={() => {
              setSent(false);
              setProblem(null);
            }}
          >
            Use a different email
          </button>
        </div>
      </AuthLayout>
    );
  return (
    <AuthLayout
      intro={{
        title: (
          <>
            Your people.
            <br />
            Your next plan.
          </>
        ),
        lede: "Create an account to join sessions and run your own.",
      }}
      title="Create your account"
    >
      <Unavailable />
      {config?.auth?.password ? (
        <form className="auth-form" onSubmit={(event) => void submit(event)}>
          <LocalNote />
          <Field id="name" label="Your name">
            <input
              id="name"
              autoComplete="name"
              maxLength={80}
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </Field>
          <EmailField value={email} onChange={setEmail} />
          <PasswordField
            id="password"
            label="Password"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
          />
          {problem ? <Notice>{problem}</Notice> : null}
          <button
            className={buttonClass({ variant: "primary", wide: true })}
            disabled={busy || !client}
          >
            {busy ? "Creating your account…" : "Create account"}
            <ArrowRightIcon size={18} aria-hidden="true" />
          </button>
        </form>
      ) : null}
      <p className="rp-help signin-footnote">
        Already have an account?{" "}
        <Link href={withNext("/sign-in", next)}>Sign in</Link>
      </p>
    </AuthLayout>
  );
}

export function ForgotPassword() {
  const { config, client } = useAuth();
  const next = useNext();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!client) return;
    setBusy(true);
    setProblem(null);
    const { error } = await client.auth.resetPasswordForEmail(email, {
      redirectTo: redirectUrl(),
    });
    setBusy(false);
    // Only a failure that reveals nothing about the account is shown.
    const shown =
      error && !hidesAccount(error.code) ? commonError(error) : null;
    if (shown) setProblem(shown);
    else setSent(true);
  }
  return (
    <AuthLayout title={sent ? "Check your email" : "Reset your password"}>
      {sent ? (
        <p role="status">
          If there’s an account for that email, we’ve sent a link.
        </p>
      ) : (
        <>
          <Unavailable />
          {config?.auth?.password ? (
            <form
              className="auth-form"
              onSubmit={(event) => void submit(event)}
            >
              <p className="rp-help">
                We’ll email you a link to choose a new password.
              </p>
              <EmailField value={email} onChange={setEmail} />
              {problem ? <Notice>{problem}</Notice> : null}
              <button
                className={buttonClass({ variant: "primary", wide: true })}
                disabled={busy || !client}
              >
                {busy ? "Sending…" : "Send link"}
              </button>
            </form>
          ) : null}
        </>
      )}
      <p className="rp-help signin-footnote">
        <Link href={withNext("/sign-in", next)}>Back to sign in</Link>
      </p>
    </AuthLayout>
  );
}

/** What to say when an email link didn't sign anyone in. */
function LinkProblem({ kind }: { kind: LinkError }) {
  return (
    <AuthLayout
      title={
        kind === "other_browser" ? "Sign in to continue" : "Link not valid"
      }
    >
      {kind === "other_browser" ? (
        <>
          <p>Your email is confirmed. Sign in to continue.</p>
          <p className="rp-help">
            Open the reset link on the device where you asked for it, or ask for
            a new one.
          </p>
        </>
      ) : (
        <p>This link has expired or was already used.</p>
      )}
      <div className="auth-actions">
        <Link className={buttonClass({ variant: "primary" })} href="/sign-in">
          Sign in
        </Link>
        <Link className={buttonClass()} href="/forgot-password">
          Send a new link
        </Link>
      </div>
    </AuthLayout>
  );
}

export function AuthCallback() {
  const { session, loading, error, recovery, linkError } = useAuth();
  const reset =
    !!session && (recovery || isRecoverySession(session.access_token));
  useGo(
    loading || linkError || !session
      ? null
      : reset
        ? () => "/reset-password"
        : takeReturnPath,
  );
  if (error)
    return (
      <Notice>
        Sign-in did not finish.{" "}
        <Link href="/sign-in">Try signing in again</Link>.
      </Notice>
    );
  if (loading || (session && !linkError))
    return <Pending>Finishing sign-in…</Pending>;
  return <LinkProblem kind={linkError ?? "invalid"} />;
}

export function ResetPassword() {
  const { client, session, loading, recovery } = useAuth();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // Only a session that came from a reset link may set a password here.
  const allowed =
    !!session && (recovery || isRecoverySession(session.access_token));
  useGo(!loading && !allowed && !done ? () => "/sign-in" : null);
  useGo(done ? takeReturnPath : null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!client) return;
    setBusy(true);
    setProblem(null);
    const { error } = await client.auth.updateUser({ password });
    setBusy(false);
    if (!error) {
      setDone(true);
      return;
    }
    setProblem(
      error.code === "same_password"
        ? "Choose a password you haven’t used here."
        : error.code === "weak_password"
          ? "Choose a longer password."
          : (commonError(error) ??
            "Your password wasn’t changed. Please try again."),
    );
  }
  if (loading || !allowed) return <Pending />;
  return (
    <AuthLayout title="Set a new password">
      {done ? (
        <p role="status">Password updated.</p>
      ) : (
        <form className="auth-form" onSubmit={(event) => void submit(event)}>
          <PasswordField
            id="new-password"
            label="New password"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
          />
          {problem ? <Notice>{problem}</Notice> : null}
          <button
            className={buttonClass({ variant: "primary", wide: true })}
            disabled={busy}
          >
            {busy ? "Saving…" : "Save password"}
          </button>
        </form>
      )}
    </AuthLayout>
  );
}
