"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { EarnedBadgeCheck } from "./badges";
import { useRouter, useParams } from "next/navigation";
import { useAuth } from "./auth-context";
import { useApi } from "./use-api";
import { useMutation } from "./use-mutation";
import { SplitFee } from "./split-fee";
import { CancelSession, CancelledRoster } from "./cancellation-controls";
import { RegistrationPanel } from "./registration-panel";
import { PaymentInstructionsEditor } from "./payment-instructions";
import { ActivityPicker } from "./activity-picker";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/dist/csr/ArrowSquareOut";
import { ClockCountdownIcon } from "@phosphor-icons/react/dist/csr/ClockCountdown";
import { CoinsIcon } from "@phosphor-icons/react/dist/csr/Coins";
import { CopyIcon } from "@phosphor-icons/react/dist/csr/Copy";
import { DoorOpenIcon } from "@phosphor-icons/react/dist/csr/DoorOpen";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { UserPlusIcon } from "@phosphor-icons/react/dist/csr/UserPlus";
import { fromInstant, fromLocal } from "./dates";
import { ShareButton } from "./share-button";
import {
  AffixInput,
  buttonClass,
  DateTimeField,
  Field,
  Notice,
  NumberStepper,
  Pending,
  SelectField,
  SpotsMeter,
  SwitchField,
  Ticket,
} from "@rallypoint/ui";
import { DetailPage, StickyActions } from "./ui";
import {
  blankSession,
  currencies,
  feeLabel,
  normalizeSession,
} from "@rallypoint/domain/session";
import type {
  PaymentMode,
  SessionForm,
  SessionRecord,
  SharedSession,
} from "@rallypoint/domain/session";
import type { GroupSummary } from "@rallypoint/domain/contracts";

const subscribeOrigin = () => () => {};
const clientOrigin = () => window.location.origin;
const serverOrigin = () => "";

const currencyOptions = Object.keys(currencies).map((code) => ({
  value: code,
  label: code,
}));
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
        <h1>Start a group.</h1>
      </div>
      <form
        className="rp-card"
        onSubmit={(e) => {
          e.preventDefault();
          mutation.run("/api/groups", { name });
        }}
      >
        <fieldset disabled={mutation.busy || mutation.uncertain}>
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
            <button className={buttonClass({ variant: "primary" })}>
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
            className={buttonClass({ variant: "primary" })}
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
                <span className="rp-badge">
                  {
                    {
                      draft: "Draft",
                      published: "Live",
                      cancelled: "Cancelled",
                      completed: "Completed",
                    }[s.state]
                  }
                </span>
                <h3>{s.details.title || "Untitled session"}</h3>
                <p className="rp-ticket__meta rp-nums">
                  {fromLocal(s.details.startLocal)?.time ??
                    "Date to be decided"}
                </p>
                <Link className={buttonClass()} href={`/sessions/${s.id}/edit`}>
                  {s.state === "draft" ? "Continue draft" : "Manage session"}
                </Link>
              </Ticket>
            </article>
          ))}
        </div>
      ) : (
        <div className="rp-card empty-inline">
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
    // A new session reopens here after its first save, so a loaded draft
    // confirms it is saved rather than going quiet.
    [notice, setNotice] = useState(
      initial?.state === "draft" ? "Draft saved." : "",
    ),
    [error, setError] = useState<string | null>(null);
  const [copy, setCopy] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const header = useRef<HTMLHeadingElement>(null);
  // Sessions saved before payment modes behave as Pay the organizer.
  const tracked = (form.paymentMode ?? "organizer") === "organizer",
    fixedFee = (form.feeMode ?? "fixed") === "fixed";
  useEffect(() => {
    header.current?.focus();
    document.title = `${record?.state === "cancelled" ? "Cancelled" : record?.details.title || "Create session"} · RallyPoint`;
  }, [initial, record?.state, record?.details.title]);
  const mutation = useMutation<Result>((result) => {
    if (!result.session) return;
    setRecord(result.session);
    setNotice(
      result.session.state === "published"
        ? "Saved. Share the link when you’re ready."
        : "Draft saved.",
    );
    if (!record) router.replace(`/sessions/${result.session.id}/edit`);
  });
  function submit(e: FormEvent, intent: string) {
    e.preventDefault();
    setError(null);
    setNotice("");
    // Not tracked here asks for no cutoff, and only a fixed fee can release
    // unpaid spots, so what is saved follows the chosen payment.
    const details: SessionForm = tracked
      ? { ...form, releaseUnpaid: form.releaseUnpaid === true && fixedFee }
      : { ...form, cutoffLocal: form.startLocal, releaseUnpaid: false };
    try {
      normalizeSession(details, intent !== "draft");
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
        details,
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
  // Custom controls aren't all native form elements, so the fieldset's
  // disabled state is passed to them as well.
  const disabledFields =
    mutation.busy || mutation.uncertain || cancelling || locked;
  const url =
    record &&
    (record.state === "published" ||
      record.state === "completed" ||
      (record.state === "cancelled" && record.cancelledFrom === "published"))
      ? `${origin}/s/${record.slug}`
      : null;
  return (
    <DetailPage
      back={`/groups/${record?.groupId ?? groupId}`}
      backLabel="Group sessions"
      className="form-page"
    >
      <div className="page-head">
        <h1 ref={header} tabIndex={-1}>
          {terminal
            ? record?.state === "cancelled"
              ? "Cancelled"
              : "This session is closed."
            : record?.state === "published"
              ? "Your session, ready to share."
              : "Plan the next one."}
        </h1>
      </div>
      {terminal ? (
        <Notice tone="warning">
          This session has{" "}
          {record?.state === "cancelled" ? "been cancelled" : "ended"}, so it
          can’t be edited.
        </Notice>
      ) : null}
      {url ? (
        <div className="rp-card share-panel">
          <div>
            <p>Anyone with the link can see this session.</p>
            <a className="share-url" href={url}>
              {url}
            </a>
          </div>
          <div className="share-actions">
            <button
              className={buttonClass({ variant: "primary" })}
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
            <Link className={buttonClass()} href={`/s/${record!.slug}`}>
              <ArrowSquareOutIcon size={18} aria-hidden="true" />
              Open shared page
            </Link>
          </div>
          <p role="status" className="rp-help">
            {copy}
          </p>
        </div>
      ) : null}
      {record?.bookingsStarted && !terminal ? (
        <Notice tone="warning">
          People have joined, so the details can’t be changed.
        </Notice>
      ) : null}
      <form
        noValidate
        className="rp-card"
        onSubmit={(e) =>
          submit(e, record?.state === "published" ? "update" : "publish")
        }
      >
        <fieldset
          disabled={mutation.busy || mutation.uncertain || cancelling || locked}
        >
          <legend>Session details</legend>
          <Field id="title" label="Session title">
            {input("title", "text", {
              maxLength: 120,
              placeholder: "Sunday morning badminton",
            })}
          </Field>
          <ActivityPicker
            value={form.activity}
            onChange={(activity) => setForm({ ...form, activity })}
            disabled={disabledFields}
          />
          <div className="form-grid">
            <Field id="startLocal" label="Starts">
              <DateTimeField
                id="startLocal"
                title="Starts"
                value={form.startLocal}
                onChange={(next) => setForm({ ...form, startLocal: next })}
                disabled={disabledFields}
              />
            </Field>
            <Field id="endLocal" label="Ends">
              <DateTimeField
                id="endLocal"
                title="Ends"
                value={form.endLocal}
                onChange={(next) => setForm({ ...form, endLocal: next })}
                disabled={disabledFields}
              />
            </Field>
          </div>
          <Field id="location" label="Location">
            {input("location", "text", {
              maxLength: 300,
              placeholder: "Venue and meeting point",
            })}
          </Field>
          <Field
            id="instructions"
            label="Instructions (optional)"
            help="Anyone with the link can read this."
          >
            <textarea
              id="instructions"
              rows={3}
              maxLength={2000}
              value={form.instructions}
              onChange={(e) =>
                setForm({ ...form, instructions: e.target.value })
              }
              aria-describedby="instructions-help"
            />
          </Field>
          <div className="form-grid">
            <Field id="capacity" label="Capacity, in seats">
              <NumberStepper
                id="capacity"
                value={form.capacity}
                onChange={(next) => setForm({ ...form, capacity: next })}
                min={1}
                disabled={disabledFields}
              />
            </Field>
            <Field id="paymentMode" label="Payment">
              <SelectField
                id="paymentMode"
                value={form.paymentMode ?? "organizer"}
                onChange={(next) =>
                  setForm({ ...form, paymentMode: next as PaymentMode })
                }
                options={[
                  { value: "untracked", label: "Not tracked here" },
                  { value: "organizer", label: "Pay the organizer" },
                ]}
                disabled={disabledFields}
              />
            </Field>
            {tracked ? (
              <>
                <Field id="currency" label="Currency">
                  <SelectField
                    id="currency"
                    value={form.currency}
                    onChange={(next) => setForm({ ...form, currency: next })}
                    options={currencyOptions}
                    disabled={disabledFields}
                  />
                </Field>
                <Field id="feeMode" label="Pricing">
                  <SelectField
                    id="feeMode"
                    value={form.feeMode ?? "fixed"}
                    onChange={(next) =>
                      setForm({ ...form, feeMode: next as "fixed" | "split" })
                    }
                    options={[
                      { value: "fixed", label: "Fee per seat" },
                      { value: "split", label: "Total to split" },
                    ]}
                    disabled={disabledFields}
                  />
                </Field>
                <Field
                  id="fee"
                  label={
                    form.feeMode === "split"
                      ? "Total session cost"
                      : "Fixed fee per seat"
                  }
                >
                  <AffixInput
                    id="fee"
                    prefix={form.currency}
                    inputMode="decimal"
                    value={form.fee}
                    onChange={(e) => setForm({ ...form, fee: e.target.value })}
                  />
                </Field>
              </>
            ) : null}
          </div>
          <div className="form-grid">
            <Field id="openLocal" label="Registration opens">
              <DateTimeField
                id="openLocal"
                title="Registration opens"
                value={form.openLocal}
                onChange={(next) => setForm({ ...form, openLocal: next })}
                disabled={disabledFields}
              />
            </Field>
            {tracked ? (
              <Field id="cutoffLocal" label="Cancellation fee cutoff">
                <DateTimeField
                  id="cutoffLocal"
                  title="Cancellation fee cutoff"
                  value={form.cutoffLocal}
                  onChange={(next) => setForm({ ...form, cutoffLocal: next })}
                  disabled={disabledFields}
                />
              </Field>
            ) : null}
          </div>
          {tracked && fixedFee ? (
            <SwitchField
              checked={form.releaseUnpaid === true}
              onCheckedChange={(releaseUnpaid) =>
                setForm({ ...form, releaseUnpaid })
              }
              disabled={disabledFields}
            >
              Unpaid spots can go to the waitlist after the cutoff
            </SwitchField>
          ) : null}
          <SwitchField
            checked={form.guests}
            onCheckedChange={(guests) => setForm({ ...form, guests })}
            disabled={disabledFields}
            description="Two seats that join, wait and withdraw together."
          >
            Allow each participant to bring one guest
          </SwitchField>
          {!terminal ? (
            <StickyActions>
              {record?.state !== "published" ? (
                <button
                  type="button"
                  className={buttonClass()}
                  onClick={(e) => submit(e, "draft")}
                >
                  Save draft
                </button>
              ) : null}
              <button className={buttonClass({ variant: "primary" })}>
                {mutation.busy
                  ? "Saving…"
                  : record?.state === "published"
                    ? "Save changes"
                    : "Publish session"}
              </button>
            </StickyActions>
          ) : null}
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
      {record &&
      !terminal &&
      (record.details.paymentMode ?? "organizer") === "organizer" ? (
        <PaymentInstructionsEditor sessionId={record.id} slug={record.slug} />
      ) : null}
      {record && !terminal ? (
        <CancelSession
          record={record}
          saving={mutation.busy || mutation.uncertain}
          onPending={setCancelling}
          onDone={(value) => {
            setRecord(value);
            setNotice("");
            setError(null);
            setCancelling(false);
            requestAnimationFrame(() => header.current?.focus());
          }}
        />
      ) : null}
      {record?.state === "cancelled" ? (
        <>
          <p>
            Unpaid fees are no longer due. Paid records stay; arrange any refund
            outside RallyPoint.
          </p>
          {record.bookingsStarted ? (
            <CancelledRoster slug={record.slug} />
          ) : null}
        </>
      ) : null}
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
  const { details: d, groupName, counts } = shared;
  const capacity = Number(d.capacity);
  // Times read in the session's own local time, never with a zone label (D-13).
  const time = (value: string | undefined) =>
    value
      ? new Intl.DateTimeFormat("en", {
          timeZone: d.timeZone,
          weekday: "short",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        }).format(new Date(value))
      : "To be decided";
  const start = fromInstant(d.startsAt, d.timeZone);
  const end = fromInstant(d.endsAt, d.timeZone);
  // Not tracked here shows no fee or cancellation terms. A session saved
  // before payment modes behaves as Pay the organizer.
  const tracked = (d.paymentMode ?? "organizer") === "organizer";
  const hasFacts =
    tracked ||
    shared.registrationWindow === "not_open" ||
    (shared.state !== "cancelled" && d.guests);
  return (
    <DetailPage back={back} backLabel="Home" className="shared-session">
      <EarnedBadgeCheck />
      <div className="session-layout">
        <div className="session-head">
          <span className="rp-kicker">{groupName}</span>
          <h1 ref={heading} tabIndex={-1}>
            {d.title}
          </h1>
          <p className="rp-lede">{d.activity}</p>
          {shared.state !== "published" ? (
            <Notice tone="warning">
              {shared.state === "cancelled"
                ? "Cancelled — this session will not take place."
                : "This session has finished."}
            </Notice>
          ) : null}
          <Ticket date={start}>
            <div className="rp-ticket__time">
              {start
                ? `${start.time} – ${end?.time ?? "?"}`
                : "Time to be decided"}
            </div>
            <div className="rp-ticket__meta">{d.location}</div>
          </Ticket>
        </div>
        <aside className="session-side" aria-label="Places and registration">
          <div className="rp-card availability" role="status">
            {shared.state === "cancelled" ? (
              <p>
                Previously registered: {counts.confirmedSeats}{" "}
                {counts.confirmedSeats === 1 ? "seat" : "seats"}.
              </p>
            ) : (
              <SpotsMeter capacity={capacity} taken={counts.confirmedSeats} />
            )}
            {shared.state === "published" && counts.waitingParties > 0 ? (
              <p className="rp-help">
                {counts.waitingParties}{" "}
                {counts.waitingParties === 1 ? "party is" : "parties are"}{" "}
                waiting and will get the next places, in order.
              </p>
            ) : null}
            {!session ? (
              <button
                className={buttonClass({ variant: "link" })}
                onClick={result.retry}
              >
                Refresh
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
            <div className="rp-card registration-note">
              <h2>
                {shared.registrationWindow === "open"
                  ? "Come along."
                  : shared.registrationWindow === "closed"
                    ? "Registration is closed."
                    : "Registration opens soon."}
              </h2>
              <p>
                {shared.state === "cancelled"
                  ? "Sign in to view your registration record."
                  : "Sign in to join or check your place."}
              </p>
              <StickyActions>
                <Link
                  className={buttonClass({ variant: "primary" })}
                  href={`/sign-in?next=${encodeURIComponent(`/s/${slug}`)}`}
                >
                  {shared.state === "cancelled"
                    ? "View your record"
                    : "Sign in to join"}
                </Link>
                <ShareButton title={d.title} />
              </StickyActions>
            </div>
          )}
        </aside>
        <div className="session-details">
          {hasFacts ? (
            <dl className="facts">
              {tracked ? (
                <div>
                  <dt>
                    <CoinsIcon size={20} aria-hidden="true" />
                    {shared.state === "cancelled" ? "Original fee" : "Fee"}
                  </dt>
                  <dd>
                    {shared.split ? (
                      shared.state === "cancelled" ? (
                        <>
                          {feeLabel({
                            currency: shared.split.currency,
                            feeMinor: shared.split.totalMinor,
                          })}{" "}
                          session total
                        </>
                      ) : (
                        <SplitFee summary={shared.split} />
                      )
                    ) : (
                      <>{feeLabel(d)} per seat, paid to the organizer</>
                    )}
                  </dd>
                </div>
              ) : null}
              {tracked && shared.state !== "cancelled" ? (
                <div>
                  <dt>
                    <ClockCountdownIcon size={20} aria-hidden="true" />
                    Free cancellation until
                  </dt>
                  <dd>{time(d.cutoffAt)}</dd>
                </div>
              ) : null}
              {shared.registrationWindow === "not_open" ? (
                <div>
                  <dt>
                    <DoorOpenIcon size={20} aria-hidden="true" />
                    Registration opens
                  </dt>
                  <dd>{time(d.opensAt)}</dd>
                </div>
              ) : null}
              {shared.state !== "cancelled" && d.guests ? (
                <div>
                  <dt>
                    <UserPlusIcon size={20} aria-hidden="true" />
                    Guests
                  </dt>
                  <dd>You can bring one guest.</dd>
                </div>
              ) : null}
            </dl>
          ) : null}
          {d.instructions ? (
            <div className="rp-card session-instructions">
              <h2>Good to know</h2>
              <p>{d.instructions}</p>
            </div>
          ) : null}
        </div>
      </div>
    </DetailPage>
  );
}
