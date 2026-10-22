"use client";
import { useEffect, useRef, useState } from "react";
import {
  AffixInput,
  buttonClass,
  Field,
  Notice,
  Pending,
} from "@rallypoint/ui";
import { currencies } from "@rallypoint/domain/session";
import type {
  ManagedSplitClaim,
  ManagedSplitView,
  SplitPreview,
} from "@rallypoint/domain/fees";
import type { RegistrationView } from "@rallypoint/domain/registration";
import { useApi } from "./use-api";
import { useAuth } from "./auth-context";
import { useMutation } from "./use-mutation";
import { splitMoney } from "@rallypoint/domain/fees";
const amountText = (minor: number, currency: string) => {
  const precision = currencies[currency as keyof typeof currencies] ?? 2,
    scale = 10n ** BigInt(precision),
    n = BigInt(minor);
  return `${n / scale}${precision ? "." + (n % scale).toString().padStart(precision, "0") : ""}`;
};
function parseAmount(value: string, currency: string) {
  const precision = currencies[currency as keyof typeof currencies] ?? 2;
  if (
    !new RegExp(`^\\d+(?:\\.\\d{1,${precision || 1}})?$`).test(value) ||
    (precision === 0 && value.includes("."))
  )
    throw new Error(`Use at most ${precision} decimal places for ${currency}.`);
  const [whole, fraction = ""] = value.split("."),
    minor = Number(whole + fraction.padEnd(precision, "0"));
  if (!Number.isSafeInteger(minor)) throw new Error("The cost is too large.");
  return minor;
}
export function SplitControls({
  slug,
  onDone,
  refreshKey = "",
  undoPartyId,
  onUndoDone,
  partyNames = {},
}: {
  slug: string;
  onDone: (view: RegistrationView) => void;
  refreshKey?: string;
  undoPartyId?: string;
  onUndoDone?: () => void;
  partyNames?: Record<string, string>;
}) {
  const { session } = useAuth();
  const result = useApi<{ split: ManagedSplitView }>(
    `/api/splits/${slug}`,
    false,
    refreshKey,
  );
  const [loadedPreview, setPreview] = useState<SplitPreview | null>(null),
    [previewTarget, setPreviewTarget] = useState<string>(),
    [cost, setCost] = useState<string | null>(null),
    [reason, setReason] = useState(""),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const preview =
    previewTarget === `${refreshKey}:${undoPartyId ?? ""}`
      ? loadedPreview
      : null;
  const active = useRef<AbortController | null>(null),
    heading = useRef<HTMLHeadingElement>(null),
    managerHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => () => active.current?.abort(), []);
  useEffect(() => {
    if (preview) heading.current?.focus();
  }, [preview]);
  // A different restore target invalidates the previous reviewed allocation.
  useEffect(() => {
    if (undoPartyId) managerHeading.current?.focus();
  }, [undoPartyId]);
  const mutation = useMutation<{
    registration: RegistrationView;
    split: ManagedSplitView;
  }>((value) => {
    onDone(value.registration);
    setPreview(null);
    setReason("");
    setCost(null);
    setNotice("Split saved.");
    onUndoDone?.();
    result.retry();
  });
  const managed = result.data?.split,
    summary = managed?.summary;
  const finalized = !!managed?.currentRunId;
  async function review() {
    if (active.current || mutation.uncertain || !summary) return;
    setError(null);
    setNotice("");
    let totalMinor: number;
    try {
      totalMinor = parseAmount(
        cost ?? amountText(summary.totalMinor, summary.currency),
        summary.currency,
      );
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setPreview(null);
    try {
      const r = await fetch(`/api/splits/${slug}/preview`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify(
          finalized
            ? {
                intent: "correct",
                totalMinor,
                ...(undoPartyId ? { undoWaiverPartyId: undoPartyId } : {}),
              }
            : { intent: "finalize" },
        ),
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(10000),
        ]),
      });
      const data = await r.json();
      if (!r.ok)
        throw new Error(
          data.error?.message ?? "The split could not be loaded.",
        );
      if (!controller.signal.aborted) {
        setPreviewTarget(`${refreshKey}:${undoPartyId ?? ""}`);
        setPreview(data.preview);
      }
    } catch (e) {
      if (!controller.signal.aborted)
        setError(
          e instanceof Error ? e.message : "The split could not be loaded.",
        );
    } finally {
      if (active.current === controller) active.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  if (result.loading) return <Pending>Loading the split…</Pending>;
  if (result.error) return <Notice retry={result.retry}>{result.error}</Notice>;
  if (!managed || !summary) return null;
  const money = (n: number) => splitMoney(summary.currency, n),
    blocked = !!preview?.blockedPaidPartyIds.length;
  return (
    <section
      className="rp-card split-controls"
      aria-label="Manage session cost"
    >
      <h2 ref={managerHeading} tabIndex={-1}>
        Session cost
      </h2>
      <p>
        <strong>{money(summary.totalMinor)}</strong> · {summary.payingSeats}{" "}
        paying {summary.payingSeats === 1 ? "seat" : "seats"} ·{" "}
        {finalized ? "Finalized" : "Estimated"}
      </p>
      {finalized ? (
        <p className="rp-help">
          Uncovered cost: {money(managed.uncoveredMinor)}
        </p>
      ) : (
        <p className="rp-help">
          Finalize once the session starts. Payment tracking follows the final
          split.
        </p>
      )}
      <fieldset disabled={busy || mutation.busy || mutation.uncertain}>
        {finalized ? (
          <>
            {undoPartyId ? (
              <Notice tone="warning">
                This share needs a new split. Review everyone’s amounts before
                restoring it.
              </Notice>
            ) : null}
            <Field id="corrected-cost" label="Corrected total">
              <AffixInput
                id="corrected-cost"
                prefix={summary.currency}
                inputMode="decimal"
                value={cost ?? amountText(summary.totalMinor, summary.currency)}
                onChange={(e) => {
                  setCost(e.target.value);
                  setPreview(null);
                }}
              />
            </Field>
            <Field
              id="split-reason"
              label="Reason for correction"
              help="Only organizers can see this note."
            >
              <textarea
                id="split-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={300}
                rows={2}
              />
            </Field>
          </>
        ) : null}
        <button
          className={buttonClass()}
          type="button"
          onClick={() => void review()}
        >
          {busy
            ? "Loading…"
            : finalized
              ? "Review correction"
              : "Review final split"}
        </button>
        {undoPartyId ? (
          <button
            className={buttonClass({ variant: "link" })}
            type="button"
            onClick={() => {
              setPreview(null);
              onUndoDone?.();
            }}
          >
            Cancel restoration
          </button>
        ) : null}
      </fieldset>
      {preview ? (
        <section className="split-preview" aria-label="Split preview">
          <h3 ref={heading} tabIndex={-1}>
            {finalized ? "Review the changes" : "Review the final split"}
          </h3>
          <p>
            {money(preview.totalMinor)} · {preview.payingSeats} paying seats
            {finalized ? ` (previous total ${money(summary.totalMinor)})` : ""}
          </p>
          {preview.parties.length ? (
            <ul>
              {preview.parties.map((p) => (
                <li key={p.partyId}>
                  <span>
                    {p.primaryName}
                    {p.chargedSeats === 2 ? ` + ${p.guestName || "guest"}` : ""}
                    {p.markedPaid ? " · Paid" : ""}
                  </span>
                  <strong>
                    {finalized
                      ? (p.previousMinor === null
                          ? "No previous share"
                          : money(p.previousMinor)) + " → "
                      : ""}
                    {money(p.totalMinor)}
                  </strong>
                </li>
              ))}
            </ul>
          ) : (
            <p>
              No split yet. {money(preview.unallocatedMinor)} stays unallocated.
            </p>
          )}
          {blocked ? (
            <Notice>
              These changes affect an amount marked paid. Resolve the payment
              and explicitly mark it unpaid before reviewing again.
            </Notice>
          ) : null}
          <button
            type="button"
            className={buttonClass({ variant: "primary" })}
            disabled={
              blocked ||
              mutation.busy ||
              mutation.uncertain ||
              (finalized && !reason.trim())
            }
            onClick={() =>
              mutation.run(
                `/api/splits/${slug}/${finalized ? "correct" : "finalize"}`,
                {
                  basis: preview.basis,
                  ...(finalized
                    ? {
                        totalMinor: preview.totalMinor,
                        reason,
                        ...(undoPartyId
                          ? { undoWaiverPartyId: undoPartyId }
                          : {}),
                      }
                    : {}),
                },
              )
            }
          >
            {mutation.busy
              ? "Saving…"
              : finalized
                ? "Confirm correction"
                : "Finalize split"}
          </button>
        </section>
      ) : null}
      {error || mutation.error ? (
        <Notice>{error ?? mutation.error}</Notice>
      ) : null}
      {mutation.recovery}
      {notice ? <p role="status">{notice}</p> : null}
      {managed.history.length ? (
        <details>
          <summary>Pricing history</summary>
          <ul className="split-history">
            {managed.history.map((h) => (
              <li key={h.runId}>
                <strong>
                  {money(h.totalMinor)} · {h.payingSeats} paying seats
                </strong>
                <p>
                  {h.by} ·{" "}
                  <time dateTime={h.at}>{new Date(h.at).toLocaleString()}</time>
                </p>
                {h.reason ? <p>{h.reason}</p> : null}
                <ul>
                  {h.parties.map((p) => (
                    <li key={p.partyId}>
                      {partyNames[p.partyId] ?? "Party"}:{" "}
                      {p.previousMinor === null
                        ? "No previous share"
                        : money(p.previousMinor)}{" "}
                      →{" "}
                      {p.currentMinor === null
                        ? "No share"
                        : money(p.currentMinor)}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
export function PendingSplitControls({
  slug,
  partyId,
  claim,
  onDone,
  onUndoReview,
}: {
  slug: string;
  partyId: string;
  claim: ManagedSplitClaim;
  onDone: (view: RegistrationView) => void;
  onUndoReview?: () => void;
}) {
  const mutation = useMutation<{ registration: RegistrationView }>((v) =>
    onDone(v.registration),
  );
  return (
    <div className="fee-controls">
      <strong>
        {claim.waived
          ? "Waived"
          : !claim.eligible
            ? "Removed"
            : "Estimated share"}
      </strong>
      {claim.eligible ? (
        <button
          type="button"
          className={buttonClass({ size: "sm" })}
          disabled={mutation.busy || mutation.uncertain}
          onClick={() => {
            if (claim.waived && onUndoReview) {
              onUndoReview();
              return;
            }
            mutation.run(`/api/registrations/${slug}/payments`, {
              partyId,
              revision: claim.revision,
              action: claim.waived ? "undo_waiver" : "waive",
            });
          }}
        >
          {claim.waived
            ? onUndoReview
              ? "Review restored share"
              : "Undo waiver"
            : "Waive share"}
        </button>
      ) : null}
      {mutation.error ? <Notice>{mutation.error}</Notice> : null}
      {mutation.recovery}
    </div>
  );
}
