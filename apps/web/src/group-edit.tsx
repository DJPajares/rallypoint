"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { buttonClass, ChoiceTiles, Field, Notice, Sheet } from "@rallypoint/ui";
import { GlobeHemisphereWestIcon } from "@phosphor-icons/react/dist/csr/GlobeHemisphereWest";
import { LockSimpleIcon } from "@phosphor-icons/react/dist/csr/LockSimple";
import type {
  GroupSummary,
  GroupVisibility,
} from "@rallypoint/domain/contracts";
import { useMutation } from "./use-mutation";
import { StickyActions } from "./ui";
import { GroupCrest } from "./group-page";
import { visibilityHelp } from "./group-visibility";

/**
 * Edit group (owner, 2026-10-30): one form with one Save. The crest previews
 * the name as it's typed; Public or Private is a choice of two; removing the
 * group sits apart at the bottom, behind a confirmation.
 */
export function EditGroupForm({ group }: { group: GroupSummary }) {
  const router = useRouter();
  const [name, setName] = useState(group.name);
  const [visibility, setVisibility] = useState<GroupVisibility>(
    group.visibility ?? "public",
  );
  const [removeOpen, setRemoveOpen] = useState(false);
  const back = () => router.push(`/groups/${group.id}`);
  const renamed = name.trim() !== group.name;
  const switched = visibility !== (group.visibility ?? "public");
  // Saving is one action for the person; underneath it's the rename, then
  // the visibility, each with its own retry-safe key.
  const saveVisibility = useMutation<unknown>(back);
  const rename = useMutation<unknown>(() =>
    switched
      ? saveVisibility.run(`/api/groups/${group.id}/visibility`, {
          visibility,
        })
      : back(),
  );
  const remove = useMutation<unknown>(() => router.push("/workspace"));
  const saving =
    rename.busy ||
    rename.uncertain ||
    saveVisibility.busy ||
    saveVisibility.uncertain;
  const removing = remove.busy || remove.uncertain;
  const held = saving || removing;
  return (
    <>
      <header className="group-edit__head">
        <GroupCrest id={group.id} name={name.trim() || group.name} />
        <h1>Edit group</h1>
      </header>
      <form
        className="group-edit"
        onSubmit={(e) => {
          e.preventDefault();
          if (renamed)
            rename.run(`/api/groups/${group.id}/rename`, { name: name.trim() });
          else if (switched)
            saveVisibility.run(`/api/groups/${group.id}/visibility`, {
              visibility,
            });
          else back();
        }}
      >
        <fieldset disabled={held}>
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
          <div className="group-edit__choice">
            <p id="group-visibility" className="rp-field__label">
              Who can find it
            </p>
            <ChoiceTiles
              name="group-visibility"
              labelledBy="group-visibility"
              value={visibility}
              onChange={(next) => setVisibility(next as GroupVisibility)}
              disabled={held}
              tiles={[
                {
                  value: "public",
                  label: "Public",
                  icon: <GlobeHemisphereWestIcon size={26} />,
                },
                {
                  value: "private",
                  label: "Private",
                  icon: <LockSimpleIcon size={26} />,
                },
              ]}
            />
            <p className="rp-help">{visibilityHelp(visibility)}</p>
          </div>
          <StickyActions>
            {/* A disabled fieldset doesn't stop links, so hold this one still while saving. */}
            <Link
              className={buttonClass()}
              href={`/groups/${group.id}`}
              aria-disabled={held || undefined}
              tabIndex={held ? -1 : undefined}
              onClick={(e) => {
                if (held) e.preventDefault();
              }}
            >
              Cancel
            </Link>
            <button className={buttonClass({ variant: "primary" })}>
              {saving ? "Saving…" : "Save"}
            </button>
          </StickyActions>
        </fieldset>
        {rename.error ? <Notice>{rename.error}</Notice> : null}
        {rename.recovery}
        {saveVisibility.error ? <Notice>{saveVisibility.error}</Notice> : null}
        {saveVisibility.recovery}
      </form>
      <section className="group-edit__remove" aria-labelledby="remove-group">
        <h2 id="remove-group">Remove group</h2>
        <p className="rp-help">
          It disappears for everyone in it. Past sessions and badges stay.
        </p>
        <button
          type="button"
          className={buttonClass({ variant: "link" })}
          disabled={held}
          aria-haspopup="dialog"
          onClick={() => setRemoveOpen(true)}
        >
          Remove {group.name}
        </button>
        <Sheet
          open={removeOpen}
          onClose={() => setRemoveOpen(false)}
          title={`Remove ${group.name}?`}
        >
          <p>
            It disappears for everyone in it. Past sessions and badges stay.
          </p>
          <div className="fee-actions">
            <button
              type="button"
              className={buttonClass()}
              disabled={removing}
              onClick={() => setRemoveOpen(false)}
            >
              Keep it
            </button>
            <button
              type="button"
              className={buttonClass({ variant: "primary" })}
              disabled={removing}
              onClick={() => remove.run(`/api/groups/${group.id}/archive`, {})}
            >
              {remove.busy ? "Removing…" : "Remove group"}
            </button>
          </div>
          {remove.error ? <Notice>{remove.error}</Notice> : null}
          {remove.recovery}
        </Sheet>
        {!removeOpen && remove.error ? <Notice>{remove.error}</Notice> : null}
        {!removeOpen ? remove.recovery : null}
      </section>
    </>
  );
}
