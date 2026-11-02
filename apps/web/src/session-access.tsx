"use client";
import { ListSkeleton } from "./skeletons";
import { useEffect, useState } from "react";
import { buttonClass, Field, Input, Notice, Sheet } from "@rallypoint/ui";
import type { SessionAccessList } from "@rallypoint/domain/session";
import { useApi } from "./use-api";
import { TitlePill } from "./badges";

type Options = {
  groups: { id: string; name: string }[];
  people: { profileId: string; name: string; title: string | null }[];
};

/**
 * P-36: the groups and people who can see a private session. Added entries
 * show as removable chips; Add opens a sheet of your groups and people you
 * already know. The server checks every addition again on save.
 */
export function AccessList({
  list,
  onChange,
  disabled,
}: {
  list: SessionAccessList;
  onChange: (next: SessionAccessList) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const empty = !list.groups.length && !list.people.length;
  const chips = [
    ...list.groups.map((g) => ({
      key: `g${g.id}`,
      name: g.name,
      remove: () =>
        onChange({ ...list, groups: list.groups.filter((x) => x.id !== g.id) }),
    })),
    ...list.people.map((p) => ({
      key: `p${p.profileId}`,
      name: p.name,
      remove: () =>
        onChange({
          ...list,
          people: list.people.filter((x) => x.profileId !== p.profileId),
        }),
    })),
  ];
  return (
    <div className="grid justify-items-start gap-3">
      {empty ? (
        <p className="mt-1 mb-0 text-sm text-muted-foreground">
          Only you and your co-hosts can see it until you add people or invite
          them.
        </p>
      ) : (
        <ul
          className="m-0 flex list-none flex-wrap gap-2 p-0"
          aria-label="Who can see it"
        >
          {chips.map((chip) => (
            <li
              key={chip.key}
              className="inline-flex items-center gap-1 rounded-full border border-border py-1 pr-1 pl-3 text-sm"
            >
              <span>{chip.name}</span>
              <button
                type="button"
                className="inline-grid min-h-8 min-w-8 place-items-center rounded-full border-0 bg-transparent text-base text-inherit"
                aria-label={`Remove ${chip.name}`}
                disabled={disabled}
                onClick={chip.remove}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        className={buttonClass()}
        aria-haspopup="dialog"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        Add groups or people
      </button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Add groups or people"
      >
        {open ? <AccessOptions list={list} onChange={onChange} /> : null}
      </Sheet>
    </div>
  );
}

function AccessOptions({
  list,
  onChange,
}: {
  list: SessionAccessList;
  onChange: (next: SessionAccessList) => void;
}) {
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState("");
  // Searching waits for a pause in typing, so each keystroke isn't a request.
  useEffect(() => {
    const timer = setTimeout(() => setShown(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);
  const options = useApi<Options>(
    `/api/sessions/access-options${shown ? `?q=${encodeURIComponent(shown)}` : ""}`,
  );
  const hasGroup = (id: string) => list.groups.some((g) => g.id === id);
  const hasPerson = (id: string) => list.people.some((p) => p.profileId === id);
  return (
    <>
      <Field
        id="access-search"
        label="Search"
        help="Your groups and people you know."
      >
        <Input
          id="access-search"
          aria-describedby="access-search-help"
          value={query}
          maxLength={40}
          autoComplete="off"
          onChange={(e) => setQuery(e.target.value)}
        />
      </Field>
      {options.loading ? (
        <ListSkeleton label="Finding groups and people…" />
      ) : options.error ? (
        <Notice retry={options.retry}>{options.error}</Notice>
      ) : options.data ? (
        <>
          <section aria-labelledby="access-groups">
            <h3 id="access-groups">Your groups</h3>
            {options.data.groups.length ? (
              <ul className="m-0 grid list-none gap-3 p-0">
                {options.data.groups.map((g) => (
                  <li
                    key={g.id}
                    className="grid gap-2 [&_p]:m-0 grid-cols-[1fr_auto] items-center"
                  >
                    <p className="flex flex-wrap items-center gap-1 **:data-[slot=title-pill]:ml-0">
                      <strong>{g.name}</strong>
                    </p>
                    <AddButton
                      added={hasGroup(g.id)}
                      name={g.name}
                      onAdd={() =>
                        onChange({
                          ...list,
                          groups: [...list.groups, { id: g.id, name: g.name }],
                        })
                      }
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 mb-0 text-sm text-muted-foreground">
                {shown
                  ? "No group by that name."
                  : "You're not in any groups yet."}
              </p>
            )}
          </section>
          <section aria-labelledby="access-people">
            <h3 id="access-people">People you know</h3>
            {options.data.people.length ? (
              <ul className="m-0 grid list-none gap-3 p-0">
                {options.data.people.map((p) => (
                  <li
                    key={p.profileId}
                    className="grid gap-2 [&_p]:m-0 grid-cols-[1fr_auto] items-center"
                  >
                    <p className="flex flex-wrap items-center gap-1 **:data-[slot=title-pill]:ml-0">
                      <strong>{p.name}</strong>
                      <TitlePill title={p.title} />
                    </p>
                    <AddButton
                      added={hasPerson(p.profileId)}
                      name={p.name}
                      onAdd={() =>
                        onChange({
                          ...list,
                          people: [
                            ...list.people,
                            { profileId: p.profileId, name: p.name },
                          ],
                        })
                      }
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 mb-0 text-sm text-muted-foreground">
                {shown ? "Nobody by that name." : "Nobody to add yet."}
              </p>
            )}
          </section>
        </>
      ) : null}
    </>
  );
}

function AddButton({
  added,
  name,
  onAdd,
}: {
  added: boolean;
  name: string;
  onAdd: () => void;
}) {
  return (
    <button
      type="button"
      className={buttonClass({ variant: added ? "secondary" : "primary" })}
      disabled={added}
      aria-label={added ? `${name} added` : `Add ${name}`}
      onClick={onAdd}
    >
      {added ? "Added" : "Add"}
    </button>
  );
}
