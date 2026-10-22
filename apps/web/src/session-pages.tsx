"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { FormEvent, ReactNode } from "react";
import Link from "next/link";
import { useRouter, useParams } from "next/navigation";
import { useAuth } from "./auth-context";
import { useApi } from "./use-api";
import { useMutation } from "./use-mutation";
import { RegistrationPanel } from "./registration-panel";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/dist/csr/ArrowSquareOut";
import { ClockCountdownIcon } from "@phosphor-icons/react/dist/csr/ClockCountdown";
import { CoinsIcon } from "@phosphor-icons/react/dist/csr/Coins";
import { CopyIcon } from "@phosphor-icons/react/dist/csr/Copy";
import { DoorOpenIcon } from "@phosphor-icons/react/dist/csr/DoorOpen";
import { GlobeHemisphereWestIcon } from "@phosphor-icons/react/dist/csr/GlobeHemisphereWest";
import { MapPinIcon } from "@phosphor-icons/react/dist/csr/MapPin";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { UserPlusIcon } from "@phosphor-icons/react/dist/csr/UserPlus";
import { fromInstant, fromLocal } from "./dates";
import { ShareButton } from "./share-button";
import {
  DetailPage,
  Notice,
  Pending,
  SpotsMeter,
  StickyActions,
  Ticket,
} from "./ui";
import {
  blankSession,
  currencies,
  feeLabel,
  normalizeSession,
} from "@rallypoint/domain/session";
import type {
  SessionForm,
  SessionRecord,
  SharedSession,
} from "@rallypoint/domain/session";
import type { GroupSummary } from "@rallypoint/domain/contracts";

const subscribeOrigin = () => () => {};
const clientOrigin = () => window.location.origin;
const serverOrigin = () => "";

type Result = {
  session?: SessionRecord;
  group?: GroupSummary;
  groupId?: string;
};
export function CreateGroup() {
  const router = useRouter(),
    [name, setName] = useState("");
  const mutation = useMutation<Result>((result) =>
    router.push(`/groups/${result.group?.id ?? result.groupId}`),
  );
  return (
    <DetailPage back="/workspace" backLabel="Your groups" className="form-page">
      <div className="page-head">
        <span className="page-kicker">A place for your people</span>
        <h1>Start a group.</h1>
        <p className="lede">
          You’ll be its owner. You can start publishing sessions right away.
        </p>
      </div>
      <form
        className="card form-card"
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
          <StickyActions>
            <button className="button primary">
              {mutation.busy ? "Creating…" : "Create group"}
            </button>
          </StickyActions>
        </fieldset>
        {mutation.error ? <Notice>{mutation.error}</Notice> : null}
        {mutation.recovery}
      </form>
    </DetailPage>
  );
}
export function GroupSessions({ group }: { group: GroupSummary }) {
  const result = useApi<{ sessions: SessionRecord[] }>(
    `/api/groups/${group.id}/sessions`,
  );
  return (
    <section className="session-list-section">
      <div className="section-head">
        <h2>Sessions</h2>
        <StickyActions>
          <Link
            className="button primary"
            href={`/groups/${group.id}/sessions/new`}
          >
            <PlusIcon size={18} weight="bold" aria-hidden="true" />
            Create session
          </Link>
        </StickyActions>
      </div>
      {result.loading ? (
        <Pending>Finding your sessions…</Pending>
      ) : result.error ? (
        <Notice retry={result.retry}>{result.error}</Notice>
      ) : result.data?.sessions.length ? (
        <div className="session-list">
          {result.data.sessions.map((s) => (
            <article key={s.id} className="session-row">
              <Ticket date={fromLocal(s.details.startLocal)}>
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
                <p className="ticket-zone nums">
                  {fromLocal(s.details.startLocal)?.time ??
                    "Date to be decided"}{" "}
                  · {s.details.timeZone}
                </p>
                <Link
                  className="button secondary"
                  href={`/sessions/${s.id}/edit`}
                >
                  {s.state === "draft" ? "Continue draft" : "Manage session"}
                </Link>
              </Ticket>
            </article>
          ))}
        </div>
      ) : (
        <div className="card empty-inline">
          <h3>Your next get-together starts here.</h3>
          <p>Save a draft, then publish when the details are ready.</p>
        </div>
      )}
    </section>
  );
}
export function SessionEditor() {
  const { id } = useParams<{ id: string }>();
  return <SessionLoader id={id!} />;
}
function SessionLoader({ id }: { id: string }) {
  const result = useApi<{ session: SessionRecord }>(`/api/sessions/${id}`);
  if (result.loading)
    return (
      <DetailPage back="/workspace" backLabel="Your groups">
        <Pending>Opening the session…</Pending>
      </DetailPage>
    );
  if (result.error)
    return (
      <DetailPage back="/workspace" backLabel="Your groups">
        <Notice retry={result.retry}>{result.error}</Notice>
      </DetailPage>
    );
  return result.data ? (
    <Editor
      key={`${id}:${result.data.session.version}`}
      initial={result.data.session}
    />
  ) : null;
}
export function NewSession() {
  const { id } = useParams<{ id: string }>();
  const group = useApi<{ group: GroupSummary }>(`/api/groups/${id}/setup`);
  return group.loading ? (
    <DetailPage back={`/groups/${id}`} backLabel="Group sessions">
      <Pending>Opening your group…</Pending>
    </DetailPage>
  ) : group.error ? (
    <DetailPage back={`/groups/${id}`} backLabel="Group sessions">
      <Notice retry={group.retry}>{group.error}</Notice>
    </DetailPage>
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
  const router = useRouter();
  const [record, setRecord] = useState(initial);
  const origin = useSyncExternalStore(
    subscribeOrigin,
    clientOrigin,
    serverOrigin,
  );
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
    if (!record) router.replace(`/sessions/${result.session.id}/edit`);
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
    record && record.state !== "draft" ? `${origin}/s/${record.slug}` : null;
  return (
    <DetailPage
      back={`/groups/${record?.groupId ?? groupId}`}
      backLabel="Group sessions"
      className="form-page"
    >
      <div className="page-head">
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
      </div>
      {terminal ? (
        <Notice>
          This session is {record?.state}. Detail changes are closed.
        </Notice>
      ) : null}
      {url ? (
        <div className="card share-panel">
          <div>
            <span className="pill">Unlisted · version {record?.version}</span>
            <p>
              Anyone with this link can view the session. It isn’t private
              access control.
            </p>
            <a className="share-url" href={url}>
              {url}
            </a>
          </div>
          <div className="share-actions">
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
              <CopyIcon size={18} aria-hidden="true" />
              Copy link
            </button>
            <Link className="button secondary" href={`/s/${record!.slug}`}>
              <ArrowSquareOutIcon size={18} aria-hidden="true" />
              Open shared page
            </Link>
          </div>
          <p role="status" className="field-help">
            {copy}
          </p>
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
        className="card form-card"
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
          <StickyActions>
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
                  : "Publish session"}
            </button>
          </StickyActions>
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
    </DetailPage>
  );
}
export function SharedSessionPage() {
  const { slug } = useParams<{ slug: string }>();
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
  const back = session ? "/home" : "/";
  if (result.loading)
    return (
      <DetailPage back={back} backLabel="Home">
        <Pending>Opening the session…</Pending>
      </DetailPage>
    );
  if (result.error)
    return (
      <DetailPage back={back} backLabel="Home">
        <h1>Session unavailable</h1>
        <Notice retry={result.retry}>{result.error}</Notice>
        <Link href="/">Back to home</Link>
      </DetailPage>
    );
  if (!result.data) return null;
  const shared = result.data.session;
  const { details: d, groupName, version, counts } = shared;
  const capacity = Number(d.capacity);
  const time = (value: string | undefined) =>
    value
      ? new Intl.DateTimeFormat("en", {
          timeZone: d.timeZone,
          dateStyle: "full",
          timeStyle: "short",
        }).format(new Date(value))
      : "To be decided";
  const start = fromInstant(d.startsAt, d.timeZone);
  const end = fromInstant(d.endsAt, d.timeZone);
  return (
    <DetailPage back={back} backLabel="Home" className="shared-session">
      <div className="session-layout">
        <div className="session-head">
          <span className="page-kicker">{groupName} · Unlisted session</span>
          <h1 ref={heading} tabIndex={-1}>
            {d.title}
          </h1>
          <p className="lede">
            {d.activity} · {d.capacity} {capacity === 1 ? "seat" : "seats"} ·{" "}
            {feeLabel(d)} per seat
          </p>
          {shared.state !== "published" ? (
            <Notice>
              This session is {shared.state}. Existing registrations are shown
              for reference; new joins are closed.
            </Notice>
          ) : null}
          <Ticket date={start}>
            <div className="ticket-time">
              {start
                ? `${start.time} – ${end?.time ?? "?"}`
                : "Time to be decided"}
            </div>
            <div className="ticket-zone">{d.timeZone} · session time</div>
          </Ticket>
        </div>
        <aside className="session-side" aria-label="Places and registration">
          <div className="card availability" role="status">
            <SpotsMeter capacity={capacity} taken={counts.confirmedSeats} />
            <p className="field-help">
              {counts.confirmedSeats} / {d.capacity}{" "}
              {capacity === 1 ? "seat" : "seats"} confirmed ·{" "}
              {capacity - counts.confirmedSeats} open · {counts.waitingParties}{" "}
              {counts.waitingParties === 1 ? "party" : "parties"} waiting
            </p>
            {counts.waitingParties > 0 ? (
              <p className="field-help">
                Waiting parties go first. An open seat can remain unused when
                the first party needs two.
              </p>
            ) : null}
            {!session ? (
              <button className="text-button" onClick={result.retry}>
                Refresh availability
              </button>
            ) : null}
          </div>
          {session ? (
            <RegistrationPanel
              key={session.user.id + slug}
              event={shared}
              onChange={result.retry}
            />
          ) : (
            <div className="card registration-note">
              <h2>
                {shared.registrationWindow === "open"
                  ? "Come along."
                  : shared.registrationWindow === "closed"
                    ? "Registration is closed."
                    : "Registration opens soon."}
              </h2>
              <p>
                Sign in to check your place, join, or waitlist your party. A
                reservation does not grant group membership.
              </p>
              <StickyActions>
                <Link
                  className="button primary"
                  href={`/sign-in?next=${encodeURIComponent(`/s/${slug}`)}`}
                >
                  Sign in and return here
                </Link>
                <ShareButton title={d.title} />
              </StickyActions>
            </div>
          )}
        </aside>
        <div className="session-details">
          <dl className="facts">
            <div>
              <dt>
                <MapPinIcon size={20} aria-hidden="true" />
                Meet here
              </dt>
              <dd>{d.location}</dd>
            </div>
            <div>
              <dt>
                <ClockCountdownIcon size={20} aria-hidden="true" />
                Starts
              </dt>
              <dd>{time(d.startsAt)}</dd>
            </div>
            <div>
              <dt>
                <ClockCountdownIcon size={20} aria-hidden="true" />
                Ends
              </dt>
              <dd>{time(d.endsAt)}</dd>
            </div>
            <div>
              <dt>
                <GlobeHemisphereWestIcon size={20} aria-hidden="true" />
                Timezone
              </dt>
              <dd>{d.timeZone}</dd>
            </div>
            <div>
              <dt>
                <CoinsIcon size={20} aria-hidden="true" />
                Fee
              </dt>
              <dd>{feeLabel(d)} per seat · paid to the organizer</dd>
            </div>
            <div>
              <dt>
                <DoorOpenIcon size={20} aria-hidden="true" />
                Registration opens
              </dt>
              <dd>{time(d.opensAt)}</dd>
            </div>
            <div>
              <dt>
                <ClockCountdownIcon size={20} aria-hidden="true" />
                Cancellation fee cutoff
              </dt>
              <dd>{time(d.cutoffAt)}</dd>
            </div>
            <div>
              <dt>
                <UserPlusIcon size={20} aria-hidden="true" />
                Guests
              </dt>
              <dd>
                {d.guests
                  ? "One guest per participant; the party stays together."
                  : "Individual places only."}
              </dd>
            </div>
          </dl>
          {d.instructions ? (
            <div className="card session-instructions">
              <h2>Good to know</h2>
              <p>{d.instructions}</p>
            </div>
          ) : null}
          <p className="field-help">
            Before the cutoff, withdrawing removes an unpaid fee obligation. At
            or after it, the obligation remains unless the organizer waives it.
            Any refund is handled outside RallyPoint.
          </p>
          <p className="quiet-note">
            Session details · version {version}. Anyone with this link can view
            this page.
          </p>
        </div>
      </div>
    </DetailPage>
  );
}
