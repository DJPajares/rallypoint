"use client";
import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import type { CohostPerson, GroupCohosts } from "@rallypoint/domain/contracts";
import { buttonClass, Notice, Pending, Sheet } from "@rallypoint/ui";
import { useAuth } from "./auth-context";
import { PersonName } from "./badges";
import { useApi } from "./use-api";
import { useMutation } from "./use-mutation";
import { DetailPage } from "./ui";

type Action = "add" | "remove";
type Response = { operationKey: string; cohosts: GroupCohosts };
type Choose = (person: CohostPerson, action: Action) => void;

function People({
  people,
  action,
  locked,
  choose,
}: {
  people: CohostPerson[];
  action: Action;
  locked: boolean;
  choose: Choose;
}) {
  const label = action === "add" ? "Make co-host" : "Remove co-host";
  return (
    <ul className="cohost-list">
      {people.map((person) => (
        <li key={person.profileId} className="rp-card cohost-row">
          <PersonName name={person.name} profileId={person.profileId} />
          <button
            type="button"
            className={buttonClass()}
            disabled={locked}
            aria-label={`${label}: ${person.name}`}
            onClick={() => choose(person, action)}
          >
            {label}
          </button>
        </li>
      ))}
    </ul>
  );
}

// Each explicit Load more opens one bounded page. A new root revision unmounts
// these pages, so candidates from different revisions are never combined.
function Candidates({
  state,
  path,
  locked,
  choose,
  reload,
}: {
  state: GroupCohosts;
  path: string;
  locked: boolean;
  choose: Choose;
  reload: () => void;
}) {
  const [more, setMore] = useState(false);
  return (
    <div className="stack">
      <People
        people={state.candidates}
        action="add"
        locked={locked}
        choose={choose}
      />
      {state.nextCursor ? (
        more ? (
          <MoreCandidates
            path={path}
            cursor={state.nextCursor}
            revision={state.revision}
            locked={locked}
            choose={choose}
            reload={reload}
          />
        ) : (
          <button
            type="button"
            className={buttonClass()}
            disabled={locked}
            onClick={() => setMore(true)}
          >
            Load more
          </button>
        )
      ) : null}
    </div>
  );
}

function MoreCandidates({
  path,
  cursor,
  revision,
  locked,
  choose,
  reload,
}: {
  path: string;
  cursor: string;
  revision: string;
  locked: boolean;
  choose: Choose;
  reload: () => void;
}) {
  const read = useApi<{ cohosts: GroupCohosts }>(`${path}?after=${cursor}`);
  if (read.loading) return <Pending>Loading more people…</Pending>;
  if (read.error) return <Notice retry={read.retry}>{read.error}</Notice>;
  if (!read.data) return null;
  if (read.data.cohosts.revision !== revision)
    return (
      <Notice retry={reload}>
        Co-hosts changed. Reload the list before trying again.
      </Notice>
    );
  return (
    <Candidates
      state={read.data.cohosts}
      path={path}
      locked={locked}
      choose={choose}
      reload={reload}
    />
  );
}

function Editor({
  groupId,
  message,
  reload,
  saved,
}: {
  groupId: string;
  message: string;
  reload: () => void;
  saved: (message: string) => void;
}) {
  const path = `/api/sessions/${groupId}/cohosts`;
  const read = useApi<{ cohosts: GroupCohosts }>(path);
  const [remove, setRemove] = useState<CohostPerson | null>(null);
  const submitted = useRef<{ action: Action; profileId: string } | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const status = useRef<HTMLParagraphElement>(null);
  const mutation = useMutation<Response>((result) => {
    const request = submitted.current;
    const assigned = result.cohosts.assigned.some(
      (person) => person.profileId === request?.profileId,
    );
    saved(
      request && assigned === (request.action === "add")
        ? request.action === "add"
          ? "Co-host added."
          : "Co-host removed."
        : "Co-host access changed again. Review the current list.",
    );
  });
  const locked = mutation.busy || mutation.uncertain;
  const state = read.data?.cohosts;
  useEffect(() => {
    if (!read.loading) {
      (message && state ? status.current : heading.current)?.focus();
      document.title = "Co-hosts · RallyPoint";
    }
  }, [read.loading, message, state]);
  function change(person: CohostPerson, chosen: Action) {
    if (!state || locked) return;
    submitted.current = { action: chosen, profileId: person.profileId };
    mutation.run(path, {
      profileId: person.profileId,
      action: chosen,
      revision: state.revision,
    });
  }
  const feedback = (
    <>
      {mutation.error ? (
        <Notice retry={!locked ? reload : undefined}>{mutation.error}</Notice>
      ) : null}
      {mutation.recovery}
    </>
  );
  return (
    <DetailPage back={`/sessions/${groupId}/edit`} backLabel="Back to session">
      <div className="page-head">
        {state ? (
          <>
            <span className="rp-badge">Organizer</span>
            <p>Hosted by {state.group.name}</p>
          </>
        ) : null}
        <h1 ref={heading} tabIndex={-1}>
          Co-hosts
        </h1>
      </div>
      {read.loading ? (
        <Pending>Loading co-hosts…</Pending>
      ) : read.error ? (
        <Notice retry={reload}>{read.error}</Notice>
      ) : state ? (
        <>
          {message && !locked && !mutation.error ? (
            <p ref={status} role="status" tabIndex={-1}>
              {message}
            </p>
          ) : null}
          <p>Co-hosts can manage this session, its payments and check-in.</p>
          <section aria-labelledby="current-cohosts">
            <div className="section-head">
              <h2 id="current-cohosts">Current co-hosts</h2>
            </div>
            {state.assigned.length ? (
              <People
                people={state.assigned}
                action="remove"
                locked={locked}
                choose={(person) => setRemove(person)}
              />
            ) : (
              <p>No co-hosts yet.</p>
            )}
          </section>
          <section aria-labelledby="choose-cohost">
            <div className="section-head">
              <h2 id="choose-cohost">Choose a co-host</h2>
            </div>
            {state.candidates.length ? (
              <Candidates
                state={state}
                path={path}
                locked={locked}
                choose={change}
                reload={reload}
              />
            ) : (
              <p>
                People appear here after joining one of your sessions, or once
                they're in a group you admin.
              </p>
            )}
          </section>
          {!remove ? feedback : null}
          <Sheet
            open={!!remove}
            onClose={() => setRemove(null)}
            title="Remove co-host?"
          >
            <p>
              {remove?.name} will lose access to manage this session, payments
              and check-in. Their session registrations stay as they are.
            </p>
            <div className="fee-actions">
              <button
                type="button"
                className={buttonClass()}
                disabled={locked}
                onClick={() => setRemove(null)}
              >
                Keep co-host
              </button>
              <button
                type="button"
                className={buttonClass({ variant: "primary" })}
                disabled={locked}
                onClick={() => remove && change(remove, "remove")}
              >
                {mutation.busy ? "Removing…" : "Yes, remove co-host"}
              </button>
            </div>
            {feedback}
          </Sheet>
        </>
      ) : null}
    </DetailPage>
  );
}

function Workspace({ groupId }: { groupId: string }) {
  const [attempt, setAttempt] = useState(0);
  const [message, setMessage] = useState("");
  const reload = () => {
    setMessage("");
    setAttempt((n) => n + 1);
  };
  return (
    <Editor
      key={attempt}
      groupId={groupId}
      message={message}
      reload={reload}
      saved={(text) => {
        setMessage(text);
        setAttempt((n) => n + 1);
      }}
    />
  );
}

export function CohostManagement() {
  const { id } = useParams<{ id: string }>();
  const { session } = useAuth();
  // A changed identity or group discards all private pages and pending state.
  return <Workspace key={`${session?.user.id}:${id}`} groupId={id} />;
}
