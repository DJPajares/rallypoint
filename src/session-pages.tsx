import { useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useAuth } from "./auth-context";
import { useApi } from "./use-api";
import { useMutation } from "./use-mutation";
import { RegistrationPanel } from "./registration-panel";
import { Notice, Pending } from "./ui";
import {
  blankSession,
  currencies,
  feeLabel,
  normalizeSession,
} from "./shared/session";
import type {
  SessionForm,
  SessionRecord,
  SharedSession,
} from "./shared/session";
import type { GroupSummary } from "./shared/contracts";

type Result = {
  session?: SessionRecord;
  group?: GroupSummary;
  groupId?: string;
};
export function CreateGroup() {
  const navigate = useNavigate(),
    [name, setName] = useState("");
  const mutation = useMutation<Result>((result) =>
    navigate(`/groups/${result.group?.id ?? result.groupId}`),
  );
  return (
    <section className="workspace-page editor-page">
      <Link className="back-link" to="/workspace">
        ← Your groups
      </Link>
      <span className="page-kicker">A place for your people</span>
      <h1>Start a group.</h1>
      <p className="lede">
        You’ll be its owner. You can start publishing sessions right away.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          mutation.run("/api/groups", { name });
        }}
      >
        <fieldset disabled={mutation.busy || mutation.uncertain}>
          <label htmlFor="group-name">Group name</label>
          <input
            id="group-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
            required
            autoComplete="organization"
          />
          <p className="field-help">
            Event registration won’t automatically add people as members.
          </p>
          <button className="button primary">
            {mutation.busy ? "Creating…" : "Create group"}
          </button>
        </fieldset>
        {mutation.error ? <Notice>{mutation.error}</Notice> : null}
        {mutation.recovery}
      </form>
    </section>
  );
}
export function GroupSessions({ group }: { group: GroupSummary }) {
  const result = useApi<{ sessions: SessionRecord[] }>(
    `/api/groups/${group.id}/sessions`,
  );
  return (
    <section className="session-list-section">
      <div className="section-heading">
        <h2>Sessions</h2>
        <Link
          className="button primary"
          to={`/groups/${group.id}/sessions/new`}
        >
          Create session ↗
        </Link>
      </div>
      {result.loading ? (
        <Pending>Finding your sessions…</Pending>
      ) : result.error ? (
        <Notice retry={result.retry}>{result.error}</Notice>
      ) : result.data?.sessions.length ? (
        <div className="session-list">
          {result.data.sessions.map((s) => (
            <article key={s.id} className="session-row">
              <div>
                <span className="pill">
                  {
                    {
                      draft: "Draft",
                      published: "Unlisted",
                      cancelled: "Cancelled",
                      completed: "Completed",
                    }[s.state]
                  }
                </span>
                <h3>{s.details.title || "Untitled session"}</h3>
                <p>
                  {s.details.startLocal?.replace("T", " · ") ||
                    "Date to be decided"}{" "}
                  · {s.details.timeZone}
                </p>
              </div>
              <Link className="button secondary" to={`/sessions/${s.id}/edit`}>
                {s.state === "draft" ? "Continue draft" : "Manage session"}
              </Link>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <h3>Your next get-together starts here.</h3>
          <p>Save a draft, then publish when the details are ready.</p>
        </div>
      )}
    </section>
  );
}
export function SessionEditor() {
  const { id } = useParams();
  return <SessionLoader id={id!} />;
}
function SessionLoader({ id }: { id: string }) {
  const result = useApi<{ session: SessionRecord }>(`/api/sessions/${id}`);
  if (result.loading) return <Pending>Opening the session…</Pending>;
  if (result.error) return <Notice retry={result.retry}>{result.error}</Notice>;
  return result.data ? (
    <Editor
      key={`${id}:${result.data.session.version}`}
      initial={result.data.session}
    />
  ) : null;
}
export function NewSession() {
  const { id } = useParams();
  const group = useApi<{ group: GroupSummary }>(`/api/groups/${id}/setup`);
  return group.loading ? (
    <Pending>Opening your group…</Pending>
  ) : group.error ? (
    <Notice retry={group.retry}>{group.error}</Notice>
  ) : (
    <Editor groupId={id!} />
  );
}
function Field({
  name,
  label,
  children,
}: {
  name: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="session-field">
      <label htmlFor={name}>{label}</label>
      {children}
    </div>
  );
}
function Editor({
  initial,
  groupId,
}: {
  initial?: SessionRecord;
  groupId?: string;
}) {
  const navigate = useNavigate();
  const [record, setRecord] = useState(initial);
  const [form, setForm] = useState<SessionForm>(
      initial?.details ?? blankSession,
    ),
    [notice, setNotice] = useState(
      initial?.state === "draft"
        ? "Saved draft loaded. Your details are stored with your group."
        : "",
    ),
    [error, setError] = useState<string | null>(null);
  const [copy, setCopy] = useState("");
  const header = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    header.current?.focus();
    document.title = `${initial?.details.title || "Create session"} · RallyPoint`;
  }, [initial]);
  const mutation = useMutation<Result>((result) => {
    if (!result.session) return;
    setRecord(result.session);
    setNotice(
      result.session.state === "published"
        ? "Session published. Anyone with the link can view these details."
        : "Draft saved. Only your group’s organizers can see it.",
    );
    if (!record)
      navigate(`/sessions/${result.session.id}/edit`, { replace: true });
  });
  function submit(e: FormEvent, intent: string) {
    e.preventDefault();
    setError(null);
    setNotice("");
    try {
      normalizeSession(form, intent !== "draft");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Check the details.");
      return;
    }
    mutation.run(
      record ? `/api/sessions/${record.id}` : `/api/groups/${groupId}/sessions`,
      {
        groupId: record?.groupId ?? groupId,
        intent,
        version: record?.version,
        details: form,
      },
    );
  }
  function input(
    key: keyof SessionForm,
    type = "text",
    attrs: Record<string, unknown> = {},
  ) {
    return (
      <input
        id={key}
        type={type}
        value={String(form[key])}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        {...attrs}
      />
    );
  }
  const terminal =
    record?.state === "cancelled" || record?.state === "completed";
  const locked = !!record?.bookingsStarted || terminal;
  const url =
    record && record.state !== "draft"
      ? `${window.location.origin}/s/${record.slug}`
      : null;
  return (
    <section className="workspace-page editor-page">
      <Link className="back-link" to={`/groups/${record?.groupId ?? groupId}`}>
        ← Group sessions
      </Link>
      <span className="page-kicker">Make a little time together</span>
      <h1 ref={header} tabIndex={-1}>
        {terminal
          ? "This session is closed."
          : record?.state === "published"
            ? "Your session, ready to share."
            : "Plan the next one."}
      </h1>
      <p className="lede">
        The essentials first. A shared link when you’re ready.
      </p>
      {terminal ? (
        <Notice>
          This session is {record?.state}. Detail changes are closed.
        </Notice>
      ) : null}
      {url ? (
        <div className="share-panel">
          <div>
            <span className="pill">Unlisted · version {record?.version}</span>
            <p>
              Anyone with this link can view the session. It isn’t private
              access control.
            </p>
            <a href={url}>{url}</a>
          </div>
          <button
            className="button primary"
            onClick={() => {
              if (!navigator.clipboard) {
                setCopy(
                  "Copy wasn’t available. Select the link above to copy it manually.",
                );
                return;
              }
              void navigator.clipboard
                .writeText(url)
                .then(() => setCopy("Link copied."))
                .catch(() =>
                  setCopy(
                    "Copy wasn’t available. Select the link above to copy it manually.",
                  ),
                );
            }}
          >
            Copy link
          </button>
          <Link className="text-button" to={`/s/${record!.slug}`}>
            Open shared page ↗
          </Link>
          <p role="status">{copy}</p>
        </div>
      ) : null}
      {record?.bookingsStarted ? (
        <Notice>
          People have booked this session. Detail changes are locked while the
          booked-event edit policy is defined.
        </Notice>
      ) : null}
      <form
        noValidate
        onSubmit={(e) =>
          submit(e, record?.state === "published" ? "update" : "publish")
        }
      >
        <fieldset disabled={mutation.busy || mutation.uncertain || locked}>
          <legend>Session details</legend>
          <div className="form-grid">
            <Field name="title" label="Session title">
              {input("title", "text", {
                maxLength: 120,
                placeholder: "Sunday morning badminton",
              })}
            </Field>
            <Field name="activity" label="Activity">
              {input("activity", "text", {
                maxLength: 80,
                placeholder: "Badminton, pottery, a walk…",
              })}
            </Field>
          </div>
          <div className="form-grid">
            <Field name="startLocal" label="Starts">
              {input("startLocal", "datetime-local")}
            </Field>
            <Field name="endLocal" label="Ends">
              {input("endLocal", "datetime-local")}
            </Field>
          </div>
          <Field name="timeZone" label="Timezone">
            {input("timeZone", "text", { list: "timezones" })}
            <datalist id="timezones">
              {Intl.supportedValuesOf("timeZone").map((z) => (
                <option key={z} value={z} />
              ))}
            </datalist>
            <p className="field-help">
              All four times use this timezone. Repeated or missing
              daylight-saving times need a different time.
            </p>
          </Field>
          <Field name="location" label="Location">
            {input("location", "text", {
              maxLength: 300,
              placeholder: "Venue and meeting point",
            })}
          </Field>
          <Field name="instructions" label="Instructions (optional)">
            <textarea
              id="instructions"
              rows={3}
              maxLength={2000}
              value={form.instructions}
              onChange={(e) =>
                setForm({ ...form, instructions: e.target.value })
              }
            />
            <p className="field-help">
              These details appear on the shared page. Keep contact and private
              payment information out.
            </p>
          </Field>
          <div className="form-grid">
            <Field name="capacity" label="Capacity, in seats">
              {input("capacity", "text", { inputMode: "numeric" })}
            </Field>
            <Field name="currency" label="Currency">
              <select
                id="currency"
                value={form.currency}
                onChange={(e) => setForm({ ...form, currency: e.target.value })}
              >
                {Object.keys(currencies).map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
            <Field name="fee" label="Fixed fee per seat">
              {input("fee", "text", { inputMode: "decimal" })}
            </Field>
          </div>
          <div className="form-grid">
            <Field name="openLocal" label="Registration opens">
              {input("openLocal", "datetime-local")}
            </Field>
            <Field name="cutoffLocal" label="Cancellation fee cutoff">
              {input("cutoffLocal", "datetime-local")}
            </Field>
          </div>
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={form.guests}
              onChange={(e) => setForm({ ...form, guests: e.target.checked })}
            />
            Allow each participant to bring one guest (two seats together)
          </label>
          <p className="field-help">
            Unlisted is the initial visibility. Fees are tracked manually;
            RallyPoint doesn’t collect payments.
          </p>
          <div className="form-actions">
            {record?.state !== "published" ? (
              <button
                type="button"
                className="button secondary"
                onClick={(e) => submit(e, "draft")}
              >
                Save draft
              </button>
            ) : null}
            <button className="button primary">
              {mutation.busy
                ? "Saving…"
                : record?.state === "published"
                  ? "Save changes"
                  : "Publish session ↗"}
            </button>
          </div>
        </fieldset>
        {error || mutation.error ? (
          <Notice>{error ?? mutation.error}</Notice>
        ) : null}
        {mutation.recovery}
        {notice ? (
          <p className="save-status" role="status">
            {notice}
          </p>
        ) : null}
      </form>
    </section>
  );
}
export function SharedSessionPage() {
  const { slug } = useParams();
  const result = useApi<{ session: SharedSession }>(
      `/api/shared/${slug}`,
      true,
    ),
    { session } = useAuth();
  const heading = useRef<HTMLHeadingElement>(null);
  const focusedSlug = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (result.data) {
      document.title = `${result.data.session.details.title} · RallyPoint`;
      if (focusedSlug.current !== slug) {
        heading.current?.focus();
        focusedSlug.current = slug;
      }
    }
  }, [result.data, slug]);
  if (result.loading) return <Pending>Opening the session…</Pending>;
  if (result.error)
    return (
      <section className="workspace-page">
        <h1>Session unavailable</h1>
        <Notice retry={result.retry}>{result.error}</Notice>
        <Link to="/">Back to home</Link>
      </section>
    );
  if (!result.data) return null;
  const { details: d, groupName, version } = result.data.session;
  const time = (value: string | undefined) =>
    value
      ? new Intl.DateTimeFormat("en", {
          timeZone: d.timeZone,
          dateStyle: "full",
          timeStyle: "short",
        }).format(new Date(value))
      : "To be decided";
  return (
    <section className="workspace-page shared-session">
      <span className="page-kicker">{groupName} · Unlisted session</span>
      <h1 ref={heading} tabIndex={-1}>
        {d.title}
      </h1>
      <p className="lede">
        {d.activity} · {d.capacity}{" "}
        {Number(d.capacity) === 1 ? "seat" : "seats"} · {feeLabel(d)} per seat
      </p>
      {result.data.session.state !== "published" ? (
        <Notice>
          This session is {result.data.session.state}. Existing registrations
          are shown for reference; new joins are closed.
        </Notice>
      ) : null}
      <div className="availability" role="status">
        <strong>
          {result.data.session.counts.confirmedSeats} / {d.capacity}{" "}
          {Number(d.capacity) === 1 ? "seat" : "seats"}
          confirmed
        </strong>
        <span>
          {Number(d.capacity) - result.data.session.counts.confirmedSeats} open
          · {result.data.session.counts.waitingParties}{" "}
          {result.data.session.counts.waitingParties === 1
            ? "party"
            : "parties"}{" "}
          waiting
        </span>
        {result.data.session.counts.waitingParties > 0 ? (
          <p>
            Waiting parties go first. An open seat can remain unused when the
            first party needs two.
          </p>
        ) : null}
        {!session ? (
          <button className="text-button" onClick={result.retry}>
            Refresh availability
          </button>
        ) : null}
      </div>
      <div className="session-info">
        <dl>
          <dt>Starts</dt>
          <dd>{time(d.startsAt)}</dd>
          <dt>Ends</dt>
          <dd>{time(d.endsAt)}</dd>
          <dt>Timezone</dt>
          <dd>{d.timeZone}</dd>
          <dt>Meet here</dt>
          <dd>{d.location}</dd>
          <dt>Registration opens</dt>
          <dd>{time(d.opensAt)}</dd>
          <dt>Cancellation fee cutoff</dt>
          <dd>{time(d.cutoffAt)}</dd>
          <dt>Guests</dt>
          <dd>
            {d.guests
              ? "One guest per participant; the party stays together."
              : "Individual places only."}
          </dd>
        </dl>
        {d.instructions ? (
          <div className="session-instructions">
            <h2>Good to know</h2>
            <p>{d.instructions}</p>
          </div>
        ) : null}
      </div>
      {session ? (
        <RegistrationPanel
          key={session.user.id + slug}
          event={result.data.session}
          onChange={result.retry}
        />
      ) : (
        <div className="registration-note">
          <h2>
            {result.data.session.registrationWindow === "open"
              ? "Come along."
              : result.data.session.registrationWindow === "closed"
                ? "Registration is closed."
                : "Registration opens soon."}
          </h2>
          <p>
            Sign in to check your place, join, or waitlist your party. A
            reservation does not grant group membership.
          </p>
          <Link
            className="button secondary"
            to={`/sign-in?next=${encodeURIComponent(`/s/${slug}`)}`}
          >
            Sign in and return here
          </Link>
        </div>
      )}
      <p className="field-help">
        Before the cutoff, withdrawing removes an unpaid fee obligation. At or
        after it, the obligation remains unless the organizer waives it. Any
        refund is handled outside RallyPoint.
      </p>
      <p className="quiet-note">
        Session details · version {version}. Anyone with this link can view this
        page.
      </p>
    </section>
  );
}
