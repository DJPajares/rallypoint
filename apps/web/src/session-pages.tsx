"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { FormEvent, RefObject } from "react";
import Link from "next/link";
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/csr/PencilSimple";
import { EarnedBadgeCheck } from "./badges";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { useAuth } from "./auth-context";
import { useApi } from "./use-api";
import { useMutation } from "./use-mutation";
import { SplitFee } from "./split-fee";
import { CancelSession, CancelledRoster } from "./cancellation-controls";
import { RegistrationPanel } from "./registration-panel";
import { PaymentInstructionsEditor } from "./payment-instructions";
import { ActivityPicker } from "./activity-picker";
import { AccessList } from "./session-access";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/dist/csr/ArrowSquareOut";
import { ClockCountdownIcon } from "@phosphor-icons/react/dist/csr/ClockCountdown";
import { CoinsIcon } from "@phosphor-icons/react/dist/csr/Coins";
import { CopyIcon } from "@phosphor-icons/react/dist/csr/Copy";
import { DoorOpenIcon } from "@phosphor-icons/react/dist/csr/DoorOpen";
import { LockSimpleIcon } from "@phosphor-icons/react/dist/csr/LockSimple";
import { MapPinIcon } from "@phosphor-icons/react/dist/csr/MapPin";
import { RepeatIcon } from "@phosphor-icons/react/dist/csr/Repeat";
import { UserPlusIcon } from "@phosphor-icons/react/dist/csr/UserPlus";
import { fromInstant, nowLocal } from "./dates";
import { useActivities } from "./use-activities";
import { ShareButton } from "./share-button";
import {
  ActivityIcon,
  AffixInput,
  buttonClass,
  DateTimeField,
  Field,
  Notice,
  NumberStepper,
  Pending,
  SelectField,
  SpotsMeter,
  Sheet,
  SwitchField,
  Ticket,
} from "@rallypoint/ui";
import { DetailPage, StickyActions } from "./ui";
import { visibilityHelp, visibilityOptions } from "./group-visibility";
import {
  blankSession,
  currencies,
  feeLabel,
  mapsLinkError,
  normalizeSession,
  sessionEditNeedsConfirmation,
} from "@rallypoint/domain/session";
import { isPrivateStub } from "@rallypoint/domain/session";
import type {
  JoinMode,
  PaymentMode,
  PrivateSession,
  SessionAccess,
  SessionForm,
  SessionRecord,
  SharedSession,
} from "@rallypoint/domain/session";
import type { GroupSummary } from "@rallypoint/domain/contracts";
import type { RegistrationView } from "@rallypoint/domain/registration";
import { nextWeekForm } from "@rallypoint/domain/run-again";
import {
  activityFor,
  applyActivityDefaults,
  durationText,
  matchActivity,
  sessionLimitProblem,
} from "@rallypoint/domain/activities";
import type { DefaultedField } from "@rallypoint/domain/activities";
import { isGameDay, mapsUrl } from "@rallypoint/domain/my-sessions";
import { copyPaymentDetails } from "./run-again";

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
    [name, setName] = useState(""),
    [visibility, setVisibility] = useState("public");
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
          mutation.run("/api/groups", { name, visibility });
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
          <Field
            id="group-visibility"
            label="Who can find it"
            help={visibilityHelp(visibility)}
          >
            <SelectField
              id="group-visibility"
              aria-describedby="group-visibility-help"
              value={visibility}
              onChange={setVisibility}
              options={visibilityOptions}
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
/** A new session stands alone (P-35): no group to choose first. */
export function NewSession() {
  const from = useSearchParams().get("from");
  return from ? <RunAgain from={from} /> : <Editor />;
}
/** Running a session again: next week's form, filled from the source (P-22). */
function RunAgain({ from }: { from: string }) {
  const source = useApi<{ session: SessionRecord }>(`/api/sessions/${from}`);
  if (source.loading)
    return (
      <DetailPage back="/sessions" backLabel="Sessions">
        <Pending>Copying the session…</Pending>
      </DetailPage>
    );
  if (source.error || !source.data)
    return (
      <DetailPage back="/sessions" backLabel="Sessions">
        <Notice retry={source.retry}>
          {source.error ?? "That session couldn’t be opened."}
        </Notice>
      </DetailPage>
    );
  return <RunAgainEditor source={source.data.session} />;
}
function RunAgainEditor({ source }: { source: SessionRecord }) {
  // Worked out once when the form opens, so it never shifts while typing.
  const [prefill] = useState(() => nextWeekForm(source.details, Date.now()));
  return <Editor prefill={prefill} copyFrom={source} />;
}
function Editor({
  initial,
  prefill,
  copyFrom,
}: {
  initial?: SessionRecord;
  prefill?: SessionForm;
  copyFrom?: SessionRecord;
}) {
  const router = useRouter();
  const [record, setRecord] = useState(initial);
  // Only the session's organizer manages co-hosts. Save and cancel answers
  // don't repeat this, so it comes from the first read; whoever creates a
  // session is its organizer.
  const organizer = initial ? initial.canManageCohosts === true : true;
  const origin = useSyncExternalStore(
    subscribeOrigin,
    clientOrigin,
    serverOrigin,
  );
  const { session: auth } = useAuth();
  const copyFailed = useSearchParams().get("copy") === "failed";
  const [form, setForm] = useState<SessionForm>(
      initial?.details ?? prefill ?? blankSession,
    ),
    // A new session reopens here after its first save, so a loaded draft
    // confirms it is saved rather than going quiet.
    [notice, setNotice] = useState(
      initial?.state === "draft" ? "Draft saved." : "",
    ),
    [error, setError] = useState<string | null>(null);
  const [copy, setCopy] = useState("");
  // P-36: who can see a private session. Run again copies the source's list
  // on the server unless the organizer changes it here.
  const [accessList, setAccessList] = useState(
    () => initial?.access ?? copyFrom?.access ?? { groups: [], people: [] },
  );
  const [accessTouched, setAccessTouched] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pendingEdit, setPendingEdit] = useState<Record<
    string,
    unknown
  > | null>(null);
  const header = useRef<HTMLHeadingElement>(null);
  const mapsInput = useRef<HTMLInputElement>(null);
  // The shared catalog (D-23). Only a brand-new session takes an activity's
  // defaults; a field the organizer changed keeps what they set.
  const { catalog } = useActivities();
  const fresh = !initial && !prefill;
  const [touched, setTouched] = useState<ReadonlySet<DefaultedField>>(
    () => new Set(),
  );
  const activity =
    catalog && form.activity.trim()
      ? activityFor(catalog, form.activity)
      : null;
  function change(patch: Partial<SessionForm>, field?: DefaultedField) {
    const marked = field ? new Set([...touched, field]) : touched;
    if (field) setTouched(marked);
    const next = { ...form, ...patch };
    const follows = "activity" in patch || "startLocal" in patch;
    setForm(
      fresh && follows && catalog && next.activity.trim()
        ? applyActivityDefaults(
            next,
            activityFor(catalog, next.activity),
            marked,
            nowLocal(next.timeZone),
          )
        : next,
    );
  }
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
    if (record) return;
    const created = result.session,
      target = `/sessions/${created.id}/edit`;
    // A session run again brings its payment details along. A failed copy
    // never undoes the new session; its page asks for the details instead.
    const paidToOrganizer = (s: SessionRecord) =>
      (s.details.paymentMode ?? "organizer") === "organizer";
    if (
      copyFrom &&
      paidToOrganizer(copyFrom) &&
      paidToOrganizer(created) &&
      auth?.access_token
    ) {
      setNotice("Copying the payment details…");
      void copyPaymentDetails(auth.access_token, copyFrom, created.id).then(
        (copied) => router.replace(copied ? target : `${target}?copy=failed`),
      );
    } else router.replace(target);
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
    let normalized;
    try {
      normalized = normalizeSession(details, intent !== "draft");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Check the details.");
      if (e instanceof Error && e.message === mapsLinkError)
        mapsInput.current?.focus();
      return;
    }
    // The database decides; this names an out-of-range value before sending.
    const limit =
      catalog && intent !== "draft"
        ? sessionLimitProblem(
            catalog,
            record?.state === "published" ? record.details : null,
            normalized,
          )
        : null;
    if (limit) {
      setError(limit);
      return;
    }
    const sendAccess =
      normalized.access === "private" && (accessTouched || !copyFrom || record);
    const body = {
      ...(!record && copyFrom ? { fromSession: copyFrom.id } : {}),
      intent,
      version: record?.version,
      details,
      ...(sendAccess
        ? {
            access: {
              groups: accessList.groups.map((g) => g.id),
              people: accessList.people.map((p) => p.profileId),
            },
          }
        : {}),
    };
    if (record && sessionEditNeedsConfirmation(record, normalized)) {
      setPendingEdit(body);
      return;
    }
    mutation.run(record ? `/api/sessions/${record.id}` : "/api/sessions", body);
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
  const booked = !!record?.bookingsStarted;
  const started =
    record?.state === "published" &&
    !!record.details.startsAt &&
    Date.now() >= Date.parse(record.details.startsAt);
  const locked = terminal || started;
  // A rejected link is shown on its own field, from the form or the server.
  const mapsError = (error ?? mutation.error) === mapsLinkError;
  // A changed local start uses the saved session zone; never the device zone.
  const startChanged = booked && form.startLocal !== record?.details.startLocal;
  // Custom controls aren't all native form elements, so the fieldset's
  // disabled state is passed to them as well.
  const disabledFields =
    mutation.busy || mutation.uncertain || cancelling || deleting || locked;
  const url =
    record &&
    (record.state === "published" ||
      record.state === "completed" ||
      (record.state === "cancelled" && record.cancelledFrom === "published"))
      ? `${origin}/s/${record.slug}`
      : null;
  return (
    <DetailPage back="/sessions" backLabel="Sessions" className="form-page">
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
      {record && record.state !== "draft" ? (
        <div className="run-again">
          <Link
            className={buttonClass()}
            href={`/sessions/new?from=${record.id}`}
          >
            <RepeatIcon size={18} aria-hidden="true" />
            Run again next week
          </Link>
          {organizer ? (
            <Link
              className={buttonClass({ variant: "link" })}
              href={`/sessions/${record.id}/cohosts`}
            >
              Co-hosts
            </Link>
          ) : null}
        </div>
      ) : null}
      {copyFailed ? (
        <Notice tone="warning">
          The payment details weren’t copied. Add them below.
        </Notice>
      ) : null}
      {started ? (
        <Notice tone="warning">
          This session has started and can no longer be edited.
        </Notice>
      ) : null}
      {record?.bookingsStarted && !terminal ? (
        <Notice tone="warning">
          People have booked, so the fee and booking rules can't change. Cancel
          this session and publish a new one.
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
          disabled={
            mutation.busy ||
            mutation.uncertain ||
            cancelling ||
            deleting ||
            locked
          }
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
            onChange={(next) => change({ activity: next })}
            catalog={catalog}
            disabled={disabledFields}
          />
          <div className="form-grid">
            <Field id="startLocal" label="Starts">
              <DateTimeField
                id="startLocal"
                title="Starts"
                value={form.startLocal}
                onChange={(next) => change({ startLocal: next })}
                disabled={disabledFields}
              />
            </Field>
            <Field
              id="endLocal"
              label="Ends"
              help={
                activity
                  ? `Sessions run ${durationText(activity.limits.minDurationMinutes)} to ${durationText(activity.limits.maxDurationMinutes)}.`
                  : undefined
              }
            >
              <DateTimeField
                id="endLocal"
                title="Ends"
                value={form.endLocal}
                onChange={(next) => change({ endLocal: next }, "endLocal")}
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
            id="mapsLink"
            label="Google Maps link (optional)"
            help="Paste a share link from Google Maps."
          >
            <input
              ref={mapsInput}
              id="mapsLink"
              type="url"
              inputMode="url"
              autoComplete="off"
              value={form.mapsLink ?? ""}
              onChange={(e) => {
                if (mapsError) setError(null);
                setForm({ ...form, mapsLink: e.target.value });
              }}
              disabled={disabledFields}
              aria-invalid={mapsError ? true : undefined}
              aria-describedby={
                mapsError ? "mapsLink-error mapsLink-help" : "mapsLink-help"
              }
            />
            {mapsError ? (
              <p id="mapsLink-error" className="field-error" role="alert">
                {mapsLinkError}
              </p>
            ) : null}
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
            <Field
              id="capacity"
              label="Capacity, in seats"
              help={
                activity
                  ? `${activity.limits.minCapacity} to ${activity.limits.maxCapacity} seats${activity.key === "general" ? "" : ` for ${activity.name}`}.`
                  : undefined
              }
            >
              <NumberStepper
                id="capacity"
                value={form.capacity}
                onChange={(next) => change({ capacity: next }, "capacity")}
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
                disabled={disabledFields || booked}
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
                    disabled={disabledFields || booked}
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
                    disabled={disabledFields || booked}
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
                    disabled={disabledFields || booked}
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
                onChange={(next) => change({ openLocal: next }, "openLocal")}
                disabled={disabledFields || booked}
              />
            </Field>
            {tracked ? (
              <Field id="cutoffLocal" label="Cancellation fee cutoff">
                <DateTimeField
                  id="cutoffLocal"
                  title="Cancellation fee cutoff"
                  value={form.cutoffLocal}
                  onChange={(next) =>
                    change({ cutoffLocal: next }, "cutoffLocal")
                  }
                  disabled={disabledFields || (booked && !startChanged)}
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
              disabled={disabledFields || booked}
            >
              Unpaid spots can go to the waitlist after the cutoff
            </SwitchField>
          ) : null}
          <SwitchField
            checked={form.guests}
            onCheckedChange={(guests) => change({ guests }, "guests")}
            disabled={disabledFields || booked}
            description="Two seats that join, wait and withdraw together."
          >
            Allow each participant to bring one guest
          </SwitchField>
          <Field
            id="access"
            label="Who can see it"
            help={
              (form.access ?? "public") === "private"
                ? "Only people you add."
                : "Anyone with the link."
            }
          >
            <SelectField
              id="access"
              aria-describedby="access-help"
              value={form.access ?? "public"}
              onChange={(next) =>
                setForm({
                  ...form,
                  access: next as SessionAccess,
                  // Ask to join is for public sessions only.
                  ...(next === "private" ? { joinMode: "direct" } : {}),
                })
              }
              options={[
                { value: "public", label: "Public" },
                { value: "private", label: "Private" },
              ]}
              disabled={disabledFields}
            />
          </Field>
          {(form.access ?? "public") === "private" ? (
            <AccessList
              list={accessList}
              disabled={disabledFields}
              onChange={(next) => {
                setAccessList(next);
                setAccessTouched(true);
              }}
            />
          ) : null}
          {(form.access ?? "public") === "public" ? (
            <Field
              id="joinMode"
              label="Who can join"
              help={
                (form.joinMode ?? "direct") === "request"
                  ? "You accept or decline each person."
                  : "Anyone with the link can take a spot."
              }
            >
              <SelectField
                id="joinMode"
                aria-describedby="joinMode-help"
                value={form.joinMode ?? "direct"}
                onChange={(next) =>
                  setForm({ ...form, joinMode: next as JoinMode })
                }
                options={[
                  { value: "direct", label: "Join directly" },
                  { value: "request", label: "Ask to join" },
                ]}
                disabled={disabledFields}
              />
            </Field>
          ) : null}
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
        {(error || mutation.error) && !mapsError ? (
          <Notice>{error ?? mutation.error}</Notice>
        ) : null}
        {mutation.recovery}
        {notice ? (
          <p className="save-status" role="status">
            {notice}
          </p>
        ) : null}
      </form>
      <Sheet
        open={!!pendingEdit}
        onClose={() => setPendingEdit(null)}
        title="Change the time or place?"
      >
        <p>Everyone booked can withdraw without a fee until the start.</p>
        <div className="inline-actions">
          <button
            type="button"
            className={buttonClass()}
            onClick={() => setPendingEdit(null)}
          >
            Keep editing
          </button>
          <button
            type="button"
            className={buttonClass({ variant: "primary" })}
            onClick={() => {
              if (!pendingEdit || !record) return;
              const body = pendingEdit;
              setPendingEdit(null);
              mutation.run(`/api/sessions/${record.id}`, body);
            }}
          >
            Save changes
          </button>
        </div>
      </Sheet>
      {record &&
      !terminal &&
      (record.details.paymentMode ?? "organizer") === "organizer" ? (
        <PaymentInstructionsEditor sessionId={record.id} slug={record.slug} />
      ) : null}
      {record && !terminal ? (
        <CancelSession
          record={record}
          saving={mutation.busy || mutation.uncertain || deleting}
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
      {record?.state === "draft" ? (
        <DeleteDraft
          record={record}
          disabled={mutation.busy || mutation.uncertain || cancelling}
          onPending={setDeleting}
        />
      ) : null}
      {record?.state === "cancelled" ? (
        <>
          {(record.details.paymentMode ?? "organizer") === "organizer" ? (
            <p>
              Unpaid fees are no longer due. Paid records stay; arrange any
              refund outside RallyPoint.
            </p>
          ) : null}
          {record.bookingsStarted ? (
            <CancelledRoster slug={record.slug} />
          ) : null}
        </>
      ) : null}
    </DetailPage>
  );
}
/** A draft can be thrown away; anything published is cancelled instead. */
function DeleteDraft({
  record,
  disabled,
  onPending,
}: {
  record: SessionRecord;
  disabled: boolean;
  onPending: (pending: boolean) => void;
}) {
  const router = useRouter(),
    [open, setOpen] = useState(false);
  const remove = useMutation<Result>(() => router.push("/sessions"));
  const working = remove.busy || remove.uncertain;
  useEffect(() => {
    onPending(working);
  }, [working, onPending]);
  return (
    <section className="rp-card" aria-label="Delete draft">
      <button
        type="button"
        className={buttonClass()}
        disabled={disabled || working}
        onClick={() => setOpen(true)}
      >
        Delete draft
      </button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Delete this draft?"
      >
        <p>It can&apos;t be undone.</p>
        <div className="fee-actions">
          <button
            type="button"
            className={buttonClass()}
            disabled={working}
            onClick={() => setOpen(false)}
          >
            Keep it
          </button>
          <button
            type="button"
            className={buttonClass({ variant: "primary" })}
            disabled={working}
            onClick={() => remove.run(`/api/sessions/${record.id}/delete`, {})}
          >
            {remove.busy ? "Deleting…" : "Delete draft"}
          </button>
        </div>
        {remove.error ? <Notice>{remove.error}</Notice> : null}
        {remove.recovery}
      </Sheet>
      {!open && remove.error ? <Notice>{remove.error}</Notice> : null}
      {!open ? remove.recovery : null}
    </section>
  );
}
// Times read in the session's own local time, never with a zone label (D-13).
function sessionTime(shared: SharedSession, value: string | undefined) {
  return value
    ? new Intl.DateTimeFormat("en", {
        timeZone: shared.details.timeZone,
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(value))
    : "To be decided";
}
/** When and where: the date stub, the time, the venue and its maps link. */
function SessionTicket({ shared }: { shared: SharedSession }) {
  const d = shared.details;
  const start = fromInstant(d.startsAt, d.timeZone);
  const end = fromInstant(d.endsAt, d.timeZone);
  // The organizer's pasted place wins; otherwise search for the venue text.
  const mapHref = d.mapsLink || mapsUrl(d.location);
  return (
    <Ticket date={start}>
      <div className="rp-ticket__time">
        {start ? `${start.time} – ${end?.time ?? "?"}` : "Time to be decided"}
      </div>
      <div className="rp-ticket__meta">{d.location}</div>
      {mapHref ? (
        <a
          className={buttonClass({ variant: "link" })}
          href={mapHref}
          target="_blank"
          rel="noopener noreferrer"
        >
          <MapPinIcon size={18} aria-hidden="true" />
          Open in Google Maps
        </a>
      ) : null}
    </Ticket>
  );
}
function SessionHead({
  shared,
  heading,
  ticket = true,
  manageHref,
}: {
  shared: SharedSession;
  heading: RefObject<HTMLHeadingElement | null>;
  ticket?: boolean;
  /** P-33: the editor, for the session's organizers and co-hosts only. */
  manageHref?: string;
}) {
  const { catalog } = useActivities();
  return (
    <div className="session-head">
      {/* Group and activity share one line, so the title stands alone. */}
      <span className="rp-kicker session-kicker">
        {shared.details.activity ? (
          <ActivityIcon
            icon={
              (catalog &&
                matchActivity(catalog, shared.details.activity)?.icon) ??
              "general"
            }
            size={16}
          />
        ) : null}
        Hosted by {shared.groupName}
        {shared.details.activity ? ` · ${shared.details.activity}` : ""}
        {shared.details.access === "private" ? (
          <span className="session-private">
            {" · "}
            <LockSimpleIcon size={14} aria-hidden="true" />
            Private
          </span>
        ) : null}
      </span>
      <h1 ref={heading} tabIndex={-1}>
        {shared.details.title}
      </h1>
      {/* Secondary, so Share stays the one primary action (D-15). */}
      {manageHref ? (
        <Link
          className={buttonClass({ size: "sm" })}
          href={manageHref}
        >
          <PencilSimpleIcon size={16} aria-hidden="true" />
          Manage session
        </Link>
      ) : null}
      {shared.state !== "published" ? (
        <Notice tone="warning">
          {shared.state === "cancelled"
            ? "Cancelled — this session will not take place."
            : "This session has finished."}
        </Notice>
      ) : null}
      {ticket ? <SessionTicket shared={shared} /> : null}
    </div>
  );
}
/** The spots card. Signed out, it carries its own Refresh. */
function Availability({
  shared,
  onRefresh,
}: {
  shared: SharedSession;
  onRefresh?: () => void;
}) {
  const { counts } = shared;
  return (
    <div className="rp-card availability" role="status">
      {shared.state === "cancelled" ? (
        <p>
          Previously registered: {counts.confirmedSeats}{" "}
          {counts.confirmedSeats === 1 ? "seat" : "seats"}.
        </p>
      ) : (
        <SpotsMeter
          capacity={Number(shared.details.capacity)}
          taken={counts.confirmedSeats}
        />
      )}
      {shared.state === "published" && counts.waitingParties > 0 ? (
        <p className="rp-help">
          {counts.waitingParties}{" "}
          {counts.waitingParties === 1 ? "party is" : "parties are"} waiting and
          will get the next places, in order.
        </p>
      ) : null}
      {onRefresh ? (
        <button
          className={buttonClass({ variant: "link" })}
          onClick={onRefresh}
        >
          Refresh
        </button>
      ) : null}
    </div>
  );
}
function SessionFacts({ shared }: { shared: SharedSession }) {
  const d = shared.details;
  const time = (value: string | undefined) => sessionTime(shared, value);
  // Not tracked here shows no fee or cancellation terms, only that payment is
  // not tracked (never "Free"). A session saved before payment modes behaves
  // as Pay the organizer. Either way the facts list has its payment line.
  const tracked = (d.paymentMode ?? "organizer") === "organizer";
  return (
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
      ) : (
        <div>
          <dt>
            <CoinsIcon size={20} aria-hidden="true" />
            Payment
          </dt>
          <dd>Not tracked here</dd>
        </div>
      )}
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
  );
}
function GoodToKnow({ shared }: { shared: SharedSession }) {
  if (!shared.details.instructions) return null;
  return (
    <div className="rp-card session-instructions">
      <h2>Good to know</h2>
      <p>{shared.details.instructions}</p>
    </div>
  );
}
/**
 * The signed-in page. It owns the viewer's registration read so the page can
 * choose its layout from it; the panel shows and changes that one read. A
 * joined player gets the game-day layout until the session ends. The panel
 * keeps its place in the tree across both, so a request in flight survives
 * the switch.
 */
function SignedInSession({
  shared,
  heading,
  onChange,
}: {
  shared: SharedSession;
  heading: RefObject<HTMLHeadingElement | null>;
  onChange: () => void;
}) {
  const result = useApi<{ registration: RegistrationView }>(
    `/api/registrations/${shared.slug}`,
  );
  const [changed, setChanged] = useState<RegistrationView | null>(null);
  const view = changed ?? result.data?.registration ?? null;
  // A read in flight (a refresh, a retry, a new access token) has no view
  // yet. The layout follows the last one known, so the page doesn't flip to
  // today's layout and back; the panel still shows its own progress.
  const [lastView, setLastView] = useState<RegistrationView | null>(null);
  if (view && view !== lastView) setLastView(view);
  const layoutView = view ?? lastView;
  // Checked each minute, so the layout steps back once the session ends.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  const gameDay =
    !!layoutView &&
    isGameDay(
      {
        state: shared.state,
        endsAt: shared.details.endsAt,
        canManage: layoutView.canManage,
        ownState: layoutView.own?.state,
      },
      now,
    );
  return (
    <div
      className={
        gameDay ? "session-layout session-layout--game-day" : "session-layout"
      }
    >
      <SessionHead
        shared={shared}
        heading={heading}
        ticket={!gameDay}
        manageHref={
          layoutView?.canManage && layoutView.sessionId
            ? `/sessions/${layoutView.sessionId}/edit`
            : undefined
        }
      />
      <aside className="session-side" aria-label="Places and registration">
        {gameDay ? null : <Availability shared={shared} />}
        <RegistrationPanel
          event={shared}
          view={view}
          loading={result.loading}
          error={result.error}
          onRefresh={() => {
            setChanged(null);
            result.retry();
          }}
          onChanged={setChanged}
          onChange={onChange}
          gameDay={
            gameDay
              ? {
                  details: <SessionTicket shared={shared} />,
                  notes: <GoodToKnow shared={shared} />,
                  more: (
                    <>
                      <Availability shared={shared} />
                      <SessionFacts shared={shared} />
                    </>
                  ),
                }
              : undefined
          }
        />
      </aside>
      {gameDay ? null : (
        <div className="session-details">
          <SessionFacts shared={shared} />
          <GoodToKnow shared={shared} />
        </div>
      )}
    </div>
  );
}
export function SharedSessionPage() {
  const { slug } = useParams<{ slug: string }>();
  // Sent with sign-in (P-36): a private session shows only to its people.
  const result = useApi<{ session: SharedSession | PrivateSession }>(
      `/api/shared/${slug}`,
    ),
    { session } = useAuth();
  const heading = useRef<HTMLHeadingElement>(null);
  const focusedSlug = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (result.data) {
      const shown = result.data.session;
      document.title = `${isPrivateStub(shown) ? "Private session" : shown.details.title} · RallyPoint`;
      if (focusedSlug.current !== slug) {
        heading.current?.focus();
        focusedSlug.current = slug;
      }
    }
  }, [result.data, slug]);
  const back = session ? "/home" : "/";
  // A refresh after an action (or a renewed token) keeps the last read on
  // screen, for the same person and session only, so the page below it and
  // any message it just showed stay put.
  const viewer = `${session?.user.id ?? ""}|${slug}`;
  const [last, setLast] = useState<{
    viewer: string;
    data: NonNullable<typeof result.data>;
  } | null>(null);
  if (result.data && (last?.data !== result.data || last.viewer !== viewer))
    setLast({ viewer, data: result.data });
  const kept = result.loading && last?.viewer === viewer ? last.data : null;
  if (result.loading && !kept)
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
  const data = kept ?? result.data;
  if (!data) return null;
  const shared = data.session;
  if (isPrivateStub(shared))
    return (
      <DetailPage back={back} backLabel="Home" className="shared-session">
        <h1 ref={heading} tabIndex={-1}>
          This session is private
        </h1>
        {session ? (
          <p>Only people the organizer added can see it.</p>
        ) : (
          <>
            <p>Sign in to see it if the organizer added you.</p>
            <Link
              className={buttonClass({ variant: "primary" })}
              href={`/sign-in?next=${encodeURIComponent(`/s/${slug}`)}`}
            >
              Sign in
            </Link>
          </>
        )}
      </DetailPage>
    );
  const d = shared.details;
  return (
    <DetailPage back={back} backLabel="Home" className="shared-session">
      <EarnedBadgeCheck />
      {session ? (
        <SignedInSession
          key={session.user.id + slug}
          shared={shared}
          heading={heading}
          onChange={result.retry}
        />
      ) : (
        <div className="session-layout">
          <SessionHead shared={shared} heading={heading} />
          <aside className="session-side" aria-label="Places and registration">
            <Availability shared={shared} onRefresh={result.retry} />
            <div className="rp-card registration-note">
              {/* Open needs no heading: the button says what to do. */}
              {shared.registrationWindow === "open" ? null : (
                <h2>
                  {shared.registrationWindow === "closed"
                    ? "Registration is closed."
                    : "Registration opens soon."}
                </h2>
              )}
              <p>
                {shared.state === "cancelled"
                  ? "Sign in to view your registration record."
                  : d.joinMode === "request"
                    ? "Sign in to ask to join or check your request."
                    : "Sign in to join or check your place."}
              </p>
              <StickyActions>
                <Link
                  className={buttonClass({ variant: "primary" })}
                  href={`/sign-in?next=${encodeURIComponent(`/s/${slug}`)}`}
                >
                  {shared.state === "cancelled"
                    ? "View your record"
                    : d.joinMode === "request"
                      ? "Sign in to ask to join"
                      : "Sign in to join"}
                </Link>
                <ShareButton title={d.title} />
              </StickyActions>
            </div>
          </aside>
          <div className="session-details">
            <SessionFacts shared={shared} />
            <GoodToKnow shared={shared} />
          </div>
        </div>
      )}
    </DetailPage>
  );
}
