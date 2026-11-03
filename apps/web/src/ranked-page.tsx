"use client";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { UserIcon } from "@phosphor-icons/react/dist/csr/User";
import { UsersIcon } from "@phosphor-icons/react/dist/csr/Users";
import {
  Button,
  buttonClass,
  CheckField,
  ChoiceTiles,
  Field,
  Notice,
  SelectField,
} from "@rallypoint/ui";
import type { Court, Region } from "@rallypoint/domain/courts";
import {
  maxSearchAreas,
  maxSearchCourts,
  normalizeSearch,
  searchWindows,
} from "@rallypoint/domain/ranked-search";
import type {
  SearchError,
  SearchInvite,
  SearchView,
} from "@rallypoint/domain/ranked-search";
import { ShareButton } from "./share-button";
import { ListSkeleton } from "./skeletons";
import { useApi } from "./use-api";
import { useMutation } from "./use-mutation";

type Mine = { search: SearchView | null; invites: SearchInvite[] };

const errorClass = "mt-2 mb-0 text-sm font-medium text-danger-foreground";
const cardClass = "rounded-lg border border-border bg-card p-5";
const dateLabel = (value: string) =>
  new Date(value).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
const formatLabel = (format: string) =>
  format === "doubles" ? "Doubles" : "Singles";
const windowLabel = (key: string) =>
  searchWindows.find((w) => w.key === key)?.label ?? key;
const inviteUrl = (token: string) =>
  typeof window === "undefined"
    ? undefined
    : `${window.location.origin}/ranked/invite/${token}`;

/**
 * Ranked play (D-26, WDL-421): look for a ranked pickleball match. One search
 * at a time; it looks for 7 days. Doubles waits for the partner to accept.
 * Matches will show here when the app is opened (no alerts outside the app).
 */
export function RankedPage() {
  const [refresh, setRefresh] = useState(0);
  const mine = useApi<Mine>("/api/ranked/search", false, String(refresh));
  const reload = () => setRefresh((n) => n + 1);
  useEffect(() => {
    document.title = "Ranked · RallyPoint";
  }, []);
  const search = mine.data?.search ?? null;
  const active = search && search.state !== "ended";
  return (
    <section
      className="mx-auto grid max-w-160 gap-6"
      aria-labelledby="ranked-title"
    >
      <div>
        <h1 id="ranked-title">Ranked</h1>
        <p className="mt-1 mb-0 text-muted-foreground">
          Find a pickleball match against players at your level.
        </p>
      </div>
      {mine.loading ? (
        <ListSkeleton label="Loading your search…" rows={2} />
      ) : mine.error ? (
        <Notice retry={mine.retry}>{mine.error}</Notice>
      ) : (
        <>
          {mine.data?.invites.map((invite) => (
            <InviteCard key={invite.token} invite={invite} onDone={reload} />
          ))}
          {search && active ? (
            <ActiveSearch search={search} onDone={reload} />
          ) : (
            <>
              {search ? <EndedSearch search={search} onDone={reload} /> : null}
              <NewSearch onDone={reload} />
            </>
          )}
        </>
      )}
    </section>
  );
}

function Choices({ search }: { search: SearchView }) {
  return (
    <dl className="my-3 grid gap-1 text-sm [&_dd]:m-0 [&_dt]:font-semibold">
      <dt>Areas</dt>
      <dd>{search.areas.map((a) => a.label).join(", ")}</dd>
      {search.courts.length ? (
        <>
          <dt>Courts</dt>
          <dd>{search.courts.map((c) => c.name).join(", ")}</dd>
        </>
      ) : null}
      <dt>When</dt>
      <dd>
        {search.windows.length
          ? search.windows.map(windowLabel).join(", ")
          : "Any time"}
      </dd>
    </dl>
  );
}

function ActiveSearch({
  search,
  onDone,
}: {
  search: SearchView;
  onDone: () => void;
}) {
  const cancel = useMutation<unknown>(onDone);
  const waiting = search.state === "waiting_partner";
  return (
    <section className={cardClass} aria-labelledby="active-title">
      <h2 id="active-title" className="m-0">
        {waiting
          ? search.partner
            ? `Waiting for ${search.partner.name} to accept`
            : "Waiting for your partner"
          : `Searching for a ${formatLabel(search.format)} match`}
      </h2>
      {waiting ? null : search.partner ? (
        <p className="mt-1 mb-0">With {search.partner.name}</p>
      ) : null}
      <Choices search={search} />
      <p className="m-0 text-sm text-muted-foreground">
        {waiting
          ? `The invite is open until ${dateLabel(search.endsAt)}.`
          : `Searching until ${dateLabel(search.endsAt)}. We’ll show your match here when you open the app, so check back daily.`}
      </p>
      {cancel.error ? (
        <p role="alert" className={errorClass}>
          {cancel.error}
        </p>
      ) : null}
      {cancel.recovery}
      <div className="mt-4 flex flex-wrap gap-2">
        {search.inviteToken ? (
          <ShareButton
            primary
            title="Play ranked doubles with me on RallyPoint"
            label="Share invite link"
            url={inviteUrl(search.inviteToken)}
          />
        ) : null}
        <Button
          disabled={cancel.busy}
          onClick={() =>
            cancel.run(`/api/ranked/search/${search.id}/cancel`, {})
          }
        >
          {cancel.busy ? "Cancelling…" : "Cancel search"}
        </Button>
      </div>
    </section>
  );
}

function EndedSearch({
  search,
  onDone,
}: {
  search: SearchView;
  onDone: () => void;
}) {
  const restart = useMutation<unknown>(onDone);
  const why =
    search.endReason === "declined"
      ? `${search.partner?.name ?? "Your partner"} declined.`
      : search.endReason === "cancelled"
        ? "It was cancelled."
        : search.endReason === "unanswered"
          ? `${search.partner?.name ?? "Your partner"} didn’t answer in time.`
          : "It ran out without a match.";
  return (
    <section className={cardClass} aria-labelledby="ended-title">
      <h2 id="ended-title" className="m-0">
        Your last {formatLabel(search.format)} search ended
      </h2>
      <p className="mt-1 mb-0 text-muted-foreground">{why}</p>
      <Choices search={search} />
      {restart.error ? (
        <p role="alert" className={errorClass}>
          {restart.error}
        </p>
      ) : null}
      {restart.recovery}
      <Button
        variant="primary"
        disabled={restart.busy}
        onClick={() =>
          restart.run(`/api/ranked/search/${search.id}/restart`, {})
        }
      >
        {restart.busy ? "Starting…" : "Search again"}
      </Button>
    </section>
  );
}

function InviteCard({
  invite,
  onDone,
}: {
  invite: SearchInvite;
  onDone: () => void;
}) {
  const answer = useMutation<unknown>(onDone);
  return (
    <section className={cardClass} aria-labelledby={`invite-${invite.token}`}>
      <h2 id={`invite-${invite.token}`} className="m-0">
        {invite.starterName} invited you to play ranked{" "}
        {formatLabel(invite.format)}
      </h2>
      <p className="mt-1 mb-0">
        {invite.areas.map((a) => a.label).join(", ")} · answer by{" "}
        {dateLabel(invite.endsAt)}
      </p>
      {answer.error ? (
        <p role="alert" className={errorClass}>
          {answer.error}
        </p>
      ) : null}
      {answer.recovery}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          variant="primary"
          disabled={answer.busy}
          onClick={() =>
            answer.run(`/api/ranked/invites/${invite.token}`, { accept: true })
          }
        >
          Accept
        </Button>
        <Button
          disabled={answer.busy}
          onClick={() =>
            answer.run(`/api/ranked/invites/${invite.token}`, { accept: false })
          }
        >
          Decline
        </Button>
      </div>
    </section>
  );
}

const areaFields = [
  "Area",
  "Another area (optional)",
  "Another area (optional)",
];
// Where each kind of problem is fixed.
const errorFields: Record<SearchError["field"], string> = {
  format: "search-area-0",
  areas: "search-area-0",
  courts: "search-area-0",
  windows: "search-area-0",
  partner: "partner-known",
};

function NewSearch({ onDone }: { onDone: () => void }) {
  const areas = useApi<{ regions: Region[] }>("/api/areas", true);
  const [format, setFormat] = useState("singles");
  const [picked, setPicked] = useState(["", "", ""]);
  const [courts, setCourts] = useState<string[]>([]);
  const [windows, setWindows] = useState<string[]>([]);
  const [partnerMode, setPartnerMode] = useState<"known" | "link">("known");
  const [partner, setPartner] = useState("");
  const [errors, setErrors] = useState<SearchError[]>([]);
  const start = useMutation<unknown>(onDone);
  // The field to focus once its error has rendered.
  const focusTo = useRef<string | null>(null);
  useEffect(() => {
    if (!focusTo.current) return;
    document.getElementById(focusTo.current)?.focus();
    focusTo.current = null;
  }, [errors]);
  const regions = areas.data?.regions ?? [];
  const chosen = picked.filter(Boolean);
  const errorFor = (field: SearchError["field"]) =>
    errors.find((e) => e.field === field)?.message;
  const toggle = (list: string[], value: string, on: boolean) =>
    on ? [...list, value] : list.filter((x) => x !== value);

  function submit(event: FormEvent) {
    event.preventDefault();
    const search = normalizeSearch({
      format,
      areas: chosen,
      courts,
      windows,
      partner:
        format === "doubles"
          ? partnerMode === "link"
            ? { link: true }
            : partner
              ? { profileId: partner }
              : null
          : null,
    });
    if (!search.ok) {
      setErrors(search.errors);
      focusTo.current = errorFields[search.errors[0].field];
      return;
    }
    setErrors([]);
    start.run("/api/ranked/search", search.value);
  }

  return (
    <form noValidate onSubmit={submit} aria-labelledby="new-title">
      <h2 id="new-title" className="mb-3">
        Find a ranked match
      </h2>
      <fieldset
        disabled={start.busy}
        className={`m-0 min-w-0 ${cardClass} [&_[data-slot=field]]:mb-5`}
      >
        <p id="format-label" className="m-0 font-semibold">
          Format
        </p>
        <ChoiceTiles
          name="format"
          labelledBy="format-label"
          value={format}
          onChange={setFormat}
          tiles={[
            {
              value: "singles",
              label: "Singles",
              icon: <UserIcon size={24} aria-hidden="true" />,
            },
            {
              value: "doubles",
              label: "Doubles",
              icon: <UsersIcon size={24} aria-hidden="true" />,
            },
          ]}
        />
        <div className="mt-5">
          {areas.error ? (
            <Notice retry={areas.retry}>{areas.error}</Notice>
          ) : (
            areaFields.map((label, i) =>
              i === 0 || picked[i - 1] ? (
                <Field key={i} id={`search-area-${i}`} label={label}>
                  <SelectField
                    id={`search-area-${i}`}
                    value={picked[i]}
                    placeholder={
                      areas.loading ? "Loading areas…" : "Choose an area"
                    }
                    disabled={areas.loading}
                    aria-describedby={
                      i === 0 && errorFor("areas")
                        ? "search-areas-error"
                        : undefined
                    }
                    onChange={(next) => {
                      setPicked(picked.map((x, j) => (j === i ? next : x)));
                      setCourts([]);
                    }}
                    groups={regions.map((r) => ({
                      label: r.name,
                      options: r.areas
                        .filter(
                          (a) => a.key === picked[i] || !picked.includes(a.key),
                        )
                        .map((a) => ({ value: a.key, label: a.label })),
                    }))}
                  />
                  {i === 0 && errorFor("areas") ? (
                    <p id="search-areas-error" className={errorClass}>
                      {errorFor("areas")}
                    </p>
                  ) : null}
                  {i > 0 && picked[i] ? (
                    <Button
                      size="sm"
                      variant="link"
                      className="mt-1 px-0"
                      onClick={() => {
                        // Later areas move up, so the fields stay in order.
                        const rest = picked.filter((_, j) => j !== i);
                        setPicked([...rest, ""]);
                        setCourts([]);
                      }}
                    >
                      Remove{" "}
                      {regions
                        .flatMap((r) => r.areas)
                        .find((a) => a.key === picked[i])?.label ?? "this area"}
                    </Button>
                  ) : null}
                </Field>
              ) : null,
            )
          )}
          <p className="m-0 text-sm text-muted-foreground">
            Up to {maxSearchAreas} areas you’re happy to play in.
          </p>
        </div>

        {chosen.length ? (
          <fieldset className="mt-5 min-w-0 border-0 p-0">
            <legend className="mb-0 font-sans text-base font-semibold tracking-normal">
              Courts you’d like (optional)
            </legend>
            {chosen.map((key) => (
              <CourtChoices
                key={key}
                area={key}
                label={
                  regions.flatMap((r) => r.areas).find((a) => a.key === key)
                    ?.label ?? key
                }
                selected={courts}
                full={courts.length >= maxSearchCourts}
                onChange={(id, on) => setCourts(toggle(courts, id, on))}
              />
            ))}
            <p className="mt-3 mb-0 text-sm text-muted-foreground">
              Up to {maxSearchCourts}. Missing one?{" "}
              <Link href="/courts">Add a court</Link>.
            </p>
          </fieldset>
        ) : null}

        <fieldset className="mt-5 min-w-0 border-0 p-0">
          <legend className="mb-0 font-sans text-base font-semibold tracking-normal">
            When (optional)
          </legend>
          <div className="grid sm:grid-cols-2">
            {searchWindows.map((w) => (
              <CheckField
                key={w.key}
                checked={windows.includes(w.key)}
                onCheckedChange={(on) => setWindows(toggle(windows, w.key, on))}
              >
                {w.label}
              </CheckField>
            ))}
          </div>
          <p className="mt-3 mb-0 text-sm text-muted-foreground">
            Leave these empty for any time.
          </p>
        </fieldset>

        {format === "doubles" ? (
          <PartnerChoice
            mode={partnerMode}
            onMode={setPartnerMode}
            partner={partner}
            onPartner={setPartner}
            error={errorFor("partner")}
          />
        ) : null}

        {start.error ? (
          <p role="alert" className={errorClass}>
            {start.error}
          </p>
        ) : null}
        {start.recovery}
        <Button type="submit" variant="primary" className="mt-6">
          {start.busy
            ? "Starting…"
            : format === "doubles"
              ? "Invite partner"
              : "Start searching"}
        </Button>
      </fieldset>
    </form>
  );
}

function CourtChoices({
  area,
  label,
  selected,
  full,
  onChange,
}: {
  area: string;
  label: string;
  selected: string[];
  full: boolean;
  onChange: (id: string, on: boolean) => void;
}) {
  const courts = useApi<{ courts: Court[] }>(
    `/api/courts?area=${encodeURIComponent(area)}`,
  );
  if (courts.loading || courts.error || !courts.data?.courts.length)
    return null;
  return (
    <div className="mt-2">
      <p className="mt-3 mb-0 text-sm font-semibold text-muted-foreground">
        {label}
      </p>
      {courts.data.courts.map((c) => (
        <CheckField
          key={c.id}
          checked={selected.includes(c.id)}
          disabled={full && !selected.includes(c.id)}
          onCheckedChange={(on) => onChange(c.id, on)}
        >
          {c.name}
        </CheckField>
      ))}
    </div>
  );
}

function PartnerChoice({
  mode,
  onMode,
  partner,
  onPartner,
  error,
}: {
  mode: "known" | "link";
  onMode: (mode: "known" | "link") => void;
  partner: string;
  onPartner: (profileId: string) => void;
  error?: string;
}) {
  const people = useApi<{ people: Array<{ profileId: string; name: string }> }>(
    "/api/ranked/partners",
  );
  const known = people.data?.people ?? [];
  return (
    <fieldset
      className="mt-5 min-w-0 border-0 p-0"
      aria-describedby={error ? "partner-error" : undefined}
    >
      <legend className="mb-0 font-sans text-base font-semibold tracking-normal">
        Your partner
      </legend>
      <label className="mt-3 flex items-center gap-3 font-medium">
        <input
          id="partner-known"
          type="radio"
          name="partner-mode"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "partner-error" : undefined}
          checked={mode === "known"}
          onChange={() => onMode("known")}
        />
        Someone you’ve played with
      </label>
      {mode === "known" ? (
        people.loading ? null : people.error ? (
          <div className="mt-2 ml-7">
            <Notice retry={people.retry}>{people.error}</Notice>
          </div>
        ) : known.length ? (
          <Field id="search-partner" label="Partner" className="mt-3 ml-7">
            <SelectField
              id="search-partner"
              value={partner}
              placeholder="Choose your partner"
              onChange={onPartner}
              options={known.map((p) => ({
                value: p.profileId,
                label: p.name,
              }))}
            />
          </Field>
        ) : (
          <p className="mt-2 mb-0 ml-7 text-sm text-muted-foreground">
            Nobody yet: people show here after you’ve both been checked in at a
            session. Invite with a link instead.
          </p>
        )
      ) : null}
      <label className="mt-3 flex items-center gap-3 font-medium">
        <input
          type="radio"
          name="partner-mode"
          checked={mode === "link"}
          onChange={() => onMode("link")}
        />
        Invite with a link
      </label>
      {error ? (
        <p id="partner-error" className={errorClass}>
          {error}
        </p>
      ) : null}
      <p className="mt-3 mb-0 text-sm text-muted-foreground">
        Your search starts when your partner accepts.
      </p>
    </fieldset>
  );
}

/** A doubles invite opened from its link. */
export function RankedInvitePage() {
  const { token } = useParams<{ token: string }>();
  const [answered, setAnswered] = useState<"accepted" | "declined" | null>(
    null,
  );
  const accepting = useRef(true);
  const opened = useApi<{
    invite:
      | (SearchInvite & { open: boolean; own: boolean; direct: boolean })
      | { open: false; starterName?: undefined };
  }>(`/api/ranked/invites/${token}`);
  const answer = useMutation<unknown>(() =>
    setAnswered(accepting.current ? "accepted" : "declined"),
  );
  const invite = opened.data?.invite;
  if (opened.loading)
    return <ListSkeleton label="Opening the invite…" rows={1} />;
  return (
    <section className="mx-auto max-w-160" aria-labelledby="invite-title">
      <h1 id="invite-title">Ranked invite</h1>
      {!invite ? (
        <Notice retry={opened.retry}>
          {opened.error ?? "This invite isn’t available."}
        </Notice>
      ) : !invite.starterName ? (
        <Notice>
          This invite has already been answered, cancelled or has run out.
        </Notice>
      ) : answered ? (
        <div className={cardClass}>
          <p className="m-0">
            {answered === "accepted"
              ? "You’re in. Your search has started."
              : "You declined the invite."}
          </p>
          <Link className={buttonClass({ variant: "primary" })} href="/ranked">
            See your search
          </Link>
        </div>
      ) : (
        <div className={cardClass}>
          <h2 className="m-0">
            {invite.own
              ? `Your ranked ${formatLabel(invite.format)} invite`
              : `${invite.starterName} invited you to play ranked ${formatLabel(invite.format)}`}
          </h2>
          <p className="mt-1">{invite.areas.map((a) => a.label).join(", ")}</p>
          {invite.own ? (
            <p className="mb-0">
              This is your own invite. Share the link with your partner.
            </p>
          ) : !invite.open ? (
            <p className="mb-0">
              This invite has already been answered, cancelled or has run out.
            </p>
          ) : (
            <>
              <p className="text-muted-foreground">
                Accepting starts a 7-day search for the two of you.
              </p>
              {answer.error ? (
                <p role="alert" className={errorClass}>
                  {answer.error}
                </p>
              ) : null}
              {answer.recovery}
              <Button
                variant="primary"
                disabled={answer.busy}
                onClick={() => {
                  accepting.current = true;
                  answer.run(`/api/ranked/invites/${token}`, { accept: true });
                }}
              >
                {answer.busy ? "Joining…" : "Accept"}
              </Button>
              {invite.direct ? (
                <Button
                  className="ml-2"
                  disabled={answer.busy}
                  onClick={() => {
                    accepting.current = false;
                    answer.run(`/api/ranked/invites/${token}`, {
                      accept: false,
                    });
                  }}
                >
                  Decline
                </Button>
              ) : null}
            </>
          )}
        </div>
      )}
    </section>
  );
}
