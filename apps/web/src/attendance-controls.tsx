"use client";
import { buttonClass, Notice } from "@rallypoint/ui";
import type {
  AttendanceState,
  RegistrationView,
  SeatAttendance,
} from "@rallypoint/domain/registration";
import { useMutation } from "./use-mutation";
const stateWords: Record<AttendanceState, string> = {
  unrecorded: "Not recorded",
  checked_in: "Checked in",
  no_show: "No-show",
};
const actionLabels: Record<AttendanceState, string> = {
  unrecorded: "Clear",
  checked_in: "Check in",
  no_show: "Mark no-show",
};
/**
 * One confirmed seat's attendance for organizers/co-hosts. The primary and
 * guest are separate seats. No-show is offered once the session has ended;
 * the server checks that against its own clock either way.
 */
export function SeatAttendanceControls({
  slug,
  partyId,
  name,
  seat,
  ended,
  when,
  onDone,
}: {
  slug: string;
  partyId: string;
  name: string;
  seat: SeatAttendance;
  ended: boolean;
  when: (iso: string) => string;
  onDone: (view: RegistrationView) => void;
}) {
  const mutation = useMutation<{ registration: RegistrationView }>((value) =>
    onDone(value.registration),
  );
  const labelId = `seat-${partyId}-${seat.seat}`;
  const options = (["checked_in", "no_show", "unrecorded"] as const).filter(
    (s) => s !== seat.state && (s !== "no_show" || ended),
  );
  return (
    <div className="seat-attendance">
      <span id={labelId}>
        <strong>{name}</strong> · {stateWords[seat.state]}
      </span>
      {seat.by && seat.at ? (
        <span>
          {seat.state === "unrecorded" ? "Cleared by" : "By"} {seat.by} ·{" "}
          {when(seat.at)}
        </span>
      ) : null}
      <div className="fee-actions">
        {options.map((state) => (
          <button
            key={state}
            type="button"
            className={buttonClass({ size: "sm" })}
            aria-describedby={labelId}
            disabled={mutation.busy || mutation.uncertain}
            onClick={() =>
              mutation.run(`/api/registrations/${slug}/attendance`, {
                partyId,
                seat: seat.seat,
                state,
                revision: seat.revision,
              })
            }
          >
            {actionLabels[state]}
          </button>
        ))}
      </div>
      {mutation.error ? <Notice>{mutation.error}</Notice> : null}
      {mutation.recovery}
    </div>
  );
}
