"use client";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { activityFor, matchActivity } from "@rallypoint/domain/activities";
import type { Activity } from "@rallypoint/domain/activities";
import {
  activitiesSummary,
  levelChoices,
  levelLabel,
  normalizeProfile,
} from "@rallypoint/domain/profile";
import type {
  MyProfile,
  ProfileActivity,
  ProfileError,
  SkillLevel,
} from "@rallypoint/domain/profile";
import {
  ActivityIcon,
  buttonClass,
  cx,
  Field,
  Input,
  Notice,
  Pending,
  Sheet,
  useToast,
} from "@rallypoint/ui";
import { useAuth } from "./auth-context";
import { useApi } from "./use-api";
import { useActivities } from "./use-activities";
import { DetailPage, StickyActions } from "./ui";

const maxCustom = 3;
const errorClass = "mt-2 mb-0 text-sm font-medium text-danger";

type Level = "" | SkillLevel;
interface Draft {
  name: string;
  presets: Record<string, { on: boolean; level: Level }>;
  custom: Array<{ id: number; name: string; level: Level }>;
}

const asLevel = (level: SkillLevel | null): Level => level ?? "";

// The catalog's listed activities are the choices (D-23); anything else the
// person plays is one of their own.
function startingDraft(profile: MyProfile, listed: readonly Activity[]): Draft {
  const draft: Draft = {
    name: profile.name,
    presets: Object.fromEntries(
      listed.map((a) => [a.name, { on: false, level: "" as Level }]),
    ),
    custom: [],
  };
  for (const activity of profile.activities) {
    const preset = matchActivity(listed, activity.name);
    if (preset)
      draft.presets[preset.name] = { on: true, level: asLevel(activity.level) };
    else
      draft.custom.push({
        id: draft.custom.length,
        name: activity.name,
        level: asLevel(activity.level),
      });
  }
  return draft;
}

function activitiesOf(draft: Draft): ProfileActivity[] {
  return [
    ...Object.keys(draft.presets)
      .filter((name) => draft.presets[name]!.on)
      .map((name) => ({
        name,
        level: draft.presets[name]!.level || null,
      })),
    ...draft.custom.map((row) => ({
      name: row.name,
      level: row.level || null,
    })),
  ];
}

// What the form would save, so "changed" means changed and not merely touched.
const snapshot = (draft: Draft) =>
  JSON.stringify({ name: draft.name, activities: activitiesOf(draft) });

/**
 * The self-rating for one activity: every level with what it means for that
 * activity, shown before choosing, then "No rating". Native radios, so arrow
 * keys move between them and the group is announced by its legend.
 */
function LevelPick({
  name,
  activityName,
  activity,
  value,
  onChange,
}: {
  name: string;
  activityName: string;
  activity: Activity | null;
  value: Level;
  onChange: (value: Level) => void;
}) {
  return (
    <fieldset
      data-slot="level-pick"
      className="m-0 grid min-w-0 gap-1 border-0 pt-0 pr-3 pb-3 pl-16 max-[30rem]:pl-3"
    >
      <legend className="float-left mb-1 w-full p-0 pt-1 text-sm font-semibold text-text-muted">
        Your level
        <span className="sr-only"> in {activityName}</span>
      </legend>
      {levelChoices(activity).map((choice) => (
        <label
          key={choice.value || "none"}
          className="flex min-h-touch cursor-pointer items-start gap-3 rounded-md border border-border px-3 py-2 has-checked:border-chrome has-checked:shadow-ring-chrome"
        >
          <input
            className="m-0 mt-0.5 size-check flex-none accent-stub"
            type="radio"
            name={name}
            value={choice.value}
            checked={value === choice.value}
            onChange={() => onChange(choice.value)}
          />
          <span className="grid min-w-0 gap-0.5">
            <span className="font-semibold">{choice.label}</span>
            {choice.meaning ? (
              <span className="text-sm text-text-muted">{choice.meaning}</span>
            ) : null}
          </span>
        </label>
      ))}
    </fieldset>
  );
}

export function EditProfile() {
  const profile = useApi<{ profile: MyProfile }>("/api/me/profile");
  const activities = useActivities();
  if (profile.loading || activities.loading)
    return (
      <DetailPage
        back="/profile"
        backLabel="Profile"
        className="mx-auto max-w-form"
      >
        <Pending>Opening your profile…</Pending>
      </DetailPage>
    );
  if (profile.error || !profile.data)
    return (
      <DetailPage
        back="/profile"
        backLabel="Profile"
        className="mx-auto max-w-form"
      >
        <Notice retry={profile.retry}>
          {profile.error ?? "Please try again."}
        </Notice>
      </DetailPage>
    );
  if (!activities.catalog)
    return (
      <DetailPage
        back="/profile"
        backLabel="Profile"
        className="mx-auto max-w-form"
      >
        <Notice retry={activities.retry}>
          {activities.error ?? "Activities could not be loaded."}
        </Notice>
      </DetailPage>
    );
  return (
    <EditForm profile={profile.data.profile} catalog={activities.catalog} />
  );
}

function EditForm({
  profile,
  catalog,
}: {
  profile: MyProfile;
  catalog: readonly Activity[];
}) {
  const listed = catalog.filter((a) => a.listed);
  const { session } = useAuth();
  const router = useRouter();
  const toast = useToast();
  // What is saved now: the page stays open after a save, so the next save and
  // the "changed" check compare against this, not the profile first loaded.
  const [saved, setSaved] = useState(profile);
  const [initial, setInitial] = useState(() => startingDraft(profile, listed));
  const [draft, setDraft] = useState(initial);
  const [errors, setErrors] = useState<ProfileError[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [playsOpen, setPlaysOpen] = useState(true);
  const focus = useRef<string | null>(null);
  const nextId = useRef(initial.custom.length);
  const nameInput = useRef<HTMLInputElement>(null);
  const activitiesError = useRef<HTMLParagraphElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const saveButton = useRef<HTMLButtonElement>(null);
  const dirty = snapshot(draft) !== snapshot(initial);
  const nameError = errors.find((e) => e.field === "name")?.message;
  const activityError = errors.find((e) => e.field === "activities")?.message;

  // Focus lands after the render that makes its target exist.
  useEffect(() => {
    const target = focus.current;
    if (!target) return;
    focus.current = null;
    if (target === "name") nameInput.current?.focus();
    else if (target === "activities") activitiesError.current?.focus();
    else if (target === "add") addButton.current?.focus();
    else if (target === "save") saveButton.current?.focus();
    else document.getElementById(target)?.focus();
  });

  // Closing or reloading the tab with changes gets the browser's own warning.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function showErrors(next: ProfileError[]) {
    setErrors(next);
    focus.current = next.some((e) => e.field === "name")
      ? "name"
      : "activities";
  }

  // Saving again is safe, so an unclear result just asks for another go.
  function unconfirmed() {
    setProblem(
      "We couldn’t confirm your changes were saved. They’re still here — save again to be sure.",
    );
    focus.current = "save";
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setProblem(null);
    if (!draft.name.trim())
      return showErrors([{ field: "name", message: "Enter your name." }]);
    const result = normalizeProfile(
      { name: draft.name, activities: activitiesOf(draft) },
      catalog,
    );
    if (!result.ok) return showErrors(result.errors);
    setErrors([]);
    setBusy(true);
    try {
      // The whole profile replaces the old one and the last save wins, so
      // sending it again after an unclear result is safe.
      const response = await fetch("/api/me/profile", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          // An untouched sign-in name stays linked to the account, so a later
          // change to it still shows; anything else becomes the saved name.
          name:
            !saved.nameIsCustom && result.value.name === saved.name
              ? ""
              : (result.value.name ?? ""),
          activities: result.value.activities,
        }),
        signal: AbortSignal.timeout(10000),
      });
      const body = await response.json();
      if (response.ok) {
        // Stay on the page, showing what was stored (spelling tidied by the
        // server), with nothing left unsaved.
        const stored = body.profile as MyProfile;
        const next = startingDraft(stored, listed);
        next.custom = next.custom.map((row) => ({
          ...row,
          id: nextId.current++,
        }));
        setSaved(stored);
        setInitial(next);
        setDraft(next);
        toast("Profile saved.");
        focus.current = "save";
      } else if (Array.isArray(body.errors) && body.errors.length)
        showErrors(body.errors as ProfileError[]);
      else if (response.status >= 500) unconfirmed();
      else {
        setProblem(body.error?.message ?? "Please try again.");
        focus.current = "save";
      }
    } catch {
      unconfirmed();
    }
    setBusy(false);
  }

  const setPreset = (name: string, change: Partial<Draft["presets"][string]>) =>
    setDraft((d) => ({
      ...d,
      presets: { ...d.presets, [name]: { ...d.presets[name]!, ...change } },
    }));
  const setCustom = (id: number, change: Partial<Draft["custom"][number]>) =>
    setDraft((d) => ({
      ...d,
      custom: d.custom.map((row) =>
        row.id === id ? { ...row, ...change } : row,
      ),
    }));
  function addCustom() {
    const id = nextId.current++;
    setDraft((d) => ({
      ...d,
      custom: [...d.custom, { id, name: "", level: "" }],
    }));
    focus.current = `custom-${id}`;
  }
  function removeCustom(id: number) {
    setDraft((d) => ({
      ...d,
      custom: d.custom.filter((row) => row.id !== id),
    }));
    focus.current = "add";
  }
  // The dialog hands focus back on close, so put it on Cancel afterwards.
  function keepEditing() {
    setDiscarding(false);
    cancelButton.current?.focus();
  }

  return (
    <DetailPage
      back="/profile"
      backLabel="Profile"
      className="mx-auto max-w-form"
      onBack={(event) => {
        if (!dirty) return;
        event.preventDefault();
        setDiscarding(true);
      }}
    >
      <div className="mb-4">
        <h1>Edit profile</h1>
      </div>
      <form noValidate onSubmit={save}>
        <fieldset disabled={busy} className="m-0 min-w-0 border-0 p-0">
          <div className="rounded-lg border border-border bg-surface p-5">
            <Field id="profile-name" label="Name">
              <Input
                ref={nameInput}
                id="profile-name"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                autoComplete="nickname"
                aria-invalid={nameError ? true : undefined}
                aria-describedby={
                  nameError
                    ? "profile-name-error profile-visible"
                    : "profile-visible"
                }
              />
              {nameError ? (
                <p id="profile-name-error" className={errorClass}>
                  {nameError}
                </p>
              ) : null}
            </Field>
            <p
              id="profile-visible"
              className="mt-1 mb-0 text-sm text-text-muted"
            >
              Anyone with your profile link sees your name, what you play and
              your levels.
            </p>
          </div>

          <section aria-labelledby="plays-heading">
            {/* Accordion pattern: a button inside the heading opens the list;
                folded, a summary line stands in for it. */}
            <div className="mt-6 mb-1 flex items-center justify-between gap-3 [&_h2]:m-0">
              <h2 id="plays-heading" className="m-0">
                <button
                  className="group/toggle -ml-2 inline-flex min-h-touch items-center gap-2 rounded-md border-0 bg-transparent px-2 text-inherit [font:inherit] tracking-[inherit] hover:bg-surface-sunken"
                  type="button"
                  aria-expanded={playsOpen}
                  aria-controls="plays-panel"
                  onClick={() => setPlaysOpen((open) => !open)}
                >
                  Activities you play
                  <CaretDownIcon
                    className="flex-none text-text-muted transition-transform duration-200 ease-standard group-aria-[expanded=false]/toggle:-rotate-90"
                    size={20}
                    weight="bold"
                    aria-hidden="true"
                  />
                </button>
              </h2>
            </div>
            <p className="mt-0 mb-3 text-sm text-text-muted">
              {playsOpen
                ? "Tap what you play, then rate yourself honestly. A rating is optional."
                : activitiesSummary(
                    activitiesOf(draft).filter((a) => a.name in draft.presets),
                  )}
            </p>
            <div
              id="plays-panel"
              className="grid grid-rows-[0fr] transition-[grid-template-rows] duration-200 ease-standard data-open:grid-rows-[1fr]"
              data-open={playsOpen || undefined}
              inert={!playsOpen}
            >
              <div className="invisible min-h-0 overflow-hidden transition-[visibility] delay-200 duration-0 in-data-open:visible in-data-open:-m-1 in-data-open:p-1 in-data-open:delay-0">
                <ul
                  className="m-0 list-none overflow-hidden rounded-lg bg-surface p-0 shadow-sm"
                  aria-labelledby="plays-heading"
                >
                  {listed.map((activity) => {
                    const { name, key } = activity;
                    const preset = draft.presets[name]!;
                    return (
                      <li
                        key={key}
                        data-on={preset.on || undefined}
                        className="group/play border-t border-border first:border-t-0"
                      >
                        <label className="flex min-h-14 cursor-pointer items-center gap-3 px-3 py-2 hover:bg-surface-sunken has-focus-visible:outline-3 has-focus-visible:-outline-offset-3 has-focus-visible:outline-focus">
                          <input
                            type="checkbox"
                            className="sr-only"
                            checked={preset.on}
                            onChange={(e) =>
                              setPreset(name, { on: e.target.checked })
                            }
                          />
                          <span
                            className="inline-flex size-10 flex-none items-center justify-center rounded-full bg-surface-sunken text-text-muted group-data-on/play:bg-success-bg group-data-on/play:text-success"
                            aria-hidden="true"
                          >
                            <ActivityIcon icon={activity.icon} size={22} />
                          </span>
                          <span className="grid min-w-0 flex-1">
                            <span className="truncate font-semibold">
                              {name}
                            </span>
                            {preset.on ? (
                              <span className="text-sm text-text-muted">
                                {preset.level
                                  ? levelLabel[preset.level]
                                  : "Not rated"}
                              </span>
                            ) : null}
                          </span>
                          <span
                            className="inline-flex min-h-8 flex-none items-center gap-1 rounded-full border border-border-strong px-3 text-sm font-semibold text-text group-data-on/play:border-success group-data-on/play:bg-success-bg group-data-on/play:text-success"
                            aria-hidden="true"
                          >
                            {preset.on ? (
                              <>
                                <CheckIcon size={16} weight="bold" />
                                Playing
                              </>
                            ) : (
                              <>
                                <PlusIcon size={16} weight="bold" />
                                Add
                              </>
                            )}
                          </span>
                        </label>
                        {preset.on ? (
                          <LevelPick
                            name={`level-${key}`}
                            activityName={name}
                            activity={activity}
                            value={preset.level}
                            onChange={(level) => setPreset(name, { level })}
                          />
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          </section>

          <section aria-labelledby="own-heading">
            <div className="mt-6 mb-1 flex items-center justify-between gap-3 [&_h2]:m-0">
              <h2 id="own-heading">Something else?</h2>
            </div>
            <p className="mt-0 mb-3 text-sm text-text-muted">
              Add up to {maxCustom} activities that aren’t listed.
            </p>
            {draft.custom.length ? (
              <ul
                className="m-0 list-none overflow-hidden rounded-lg bg-surface p-0 shadow-sm"
                aria-labelledby="own-heading"
              >
                {draft.custom.map((row, index) => {
                  const label = `Your own activity ${index + 1}`;
                  const named = row.name.trim() || label.toLowerCase();
                  return (
                    <li
                      key={row.id}
                      className="border-t border-border first:border-t-0 **:data-[slot=level-pick]:pl-3"
                    >
                      <div className="flex items-center gap-2 p-3">
                        <Input
                          className="mt-0 flex-1"
                          id={`custom-${row.id}`}
                          aria-label={label}
                          aria-invalid={activityError ? true : undefined}
                          placeholder="Activity name"
                          value={row.name}
                          onChange={(e) =>
                            setCustom(row.id, { name: e.target.value })
                          }
                        />
                        <button
                          type="button"
                          className={buttonClass({ variant: "link" })}
                          aria-label={`Remove ${named}`}
                          onClick={() => removeCustom(row.id)}
                        >
                          Remove
                        </button>
                      </div>
                      <LevelPick
                        name={`level-custom-${row.id}`}
                        activityName={row.name.trim() || label}
                        activity={activityFor(catalog, row.name)}
                        value={row.level}
                        onChange={(level) => setCustom(row.id, { level })}
                      />
                    </li>
                  );
                })}
              </ul>
            ) : null}
            {draft.custom.length < maxCustom ? (
              <button
                ref={addButton}
                type="button"
                className={cx(buttonClass({ variant: "secondary" }), "mt-3")}
                onClick={addCustom}
              >
                <PlusIcon size={18} aria-hidden="true" />
                Add your own
              </button>
            ) : null}
            {activityError ? (
              <p
                ref={activitiesError}
                id="activities-error"
                className={errorClass}
                tabIndex={-1}
              >
                {activityError}
              </p>
            ) : null}
          </section>

          <p className="mt-6 mb-3 text-sm wrap-anywhere text-text-muted">
            Signed in as {session?.user.email ?? "your account"}
          </p>
          {problem ? <Notice>{problem}</Notice> : null}
          <StickyActions>
            <button
              ref={saveButton}
              type="submit"
              className={buttonClass({ variant: "primary" })}
              aria-busy={busy || undefined}
            >
              {busy ? "Saving…" : "Save"}
            </button>
            <button
              ref={cancelButton}
              type="button"
              className={buttonClass({ variant: "secondary" })}
              onClick={() =>
                dirty ? setDiscarding(true) : router.push("/profile")
              }
            >
              Cancel
            </button>
          </StickyActions>
        </fieldset>
      </form>
      <Sheet
        open={discarding}
        onClose={keepEditing}
        title="Discard your changes?"
      >
        <div className="mt-3 grid gap-2">
          <button
            type="button"
            className={buttonClass({ variant: "primary", wide: true })}
            onClick={() => router.push("/profile")}
          >
            Discard
          </button>
          <button
            type="button"
            className={buttonClass({ wide: true })}
            onClick={keepEditing}
          >
            Keep editing
          </button>
        </div>
      </Sheet>
    </DetailPage>
  );
}
