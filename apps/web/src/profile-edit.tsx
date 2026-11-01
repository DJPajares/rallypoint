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
    <fieldset className="level-pick">
      <legend className="level-pick__legend">
        Your level
        <span className="rp-sr-only"> in {activityName}</span>
      </legend>
      {levelChoices(activity).map((choice) => (
        <label key={choice.value || "none"} className="level-pick__option">
          <input
            type="radio"
            name={name}
            value={choice.value}
            checked={value === choice.value}
            onChange={() => onChange(choice.value)}
          />
          <span className="level-pick__text">
            <span className="level-pick__label">{choice.label}</span>
            {choice.meaning ? (
              <span className="level-pick__meaning">{choice.meaning}</span>
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
      <DetailPage back="/profile" backLabel="Profile" className="form-page">
        <Pending>Opening your profile…</Pending>
      </DetailPage>
    );
  if (profile.error || !profile.data)
    return (
      <DetailPage back="/profile" backLabel="Profile" className="form-page">
        <Notice retry={profile.retry}>
          {profile.error ?? "Please try again."}
        </Notice>
      </DetailPage>
    );
  if (!activities.catalog)
    return (
      <DetailPage back="/profile" backLabel="Profile" className="form-page">
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
      className="form-page"
      onBack={(event) => {
        if (!dirty) return;
        event.preventDefault();
        setDiscarding(true);
      }}
    >
      <div className="page-head">
        <h1>Edit profile</h1>
      </div>
      <form className="profile-form" noValidate onSubmit={save}>
        <fieldset disabled={busy}>
          <div className="rp-card">
            <Field id="profile-name" label="Name">
              <input
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
                <p id="profile-name-error" className="profile-error">
                  {nameError}
                </p>
              ) : null}
            </Field>
            <p id="profile-visible" className="rp-help">
              Anyone with your profile link sees your name and what you play.
            </p>
          </div>

          <section aria-labelledby="plays-heading">
            {/* Accordion pattern: a button inside the heading opens the list;
                folded, a summary line stands in for it. */}
            <div className="section-head">
              <h2 id="plays-heading" className="section-toggle">
                <button
                  type="button"
                  aria-expanded={playsOpen}
                  aria-controls="plays-panel"
                  onClick={() => setPlaysOpen((open) => !open)}
                >
                  Activities you play
                  <CaretDownIcon
                    className="section-toggle__caret"
                    size={20}
                    weight="bold"
                    aria-hidden="true"
                  />
                </button>
              </h2>
            </div>
            <p className="rp-help profile-form__lede">
              {playsOpen
                ? "Tap what you play, then rate yourself honestly. A rating is optional."
                : activitiesSummary(
                    activitiesOf(draft).filter((a) => a.name in draft.presets),
                  )}
            </p>
            <div
              id="plays-panel"
              className="fold"
              data-open={playsOpen || undefined}
              inert={!playsOpen}
            >
              <div className="fold__inner">
                <ul className="rp-list" aria-labelledby="plays-heading">
                  {listed.map((activity) => {
                    const { name, key } = activity;
                    const preset = draft.presets[name]!;
                    return (
                      <li
                        key={key}
                        className={cx("rp-row play-row", preset.on && "is-on")}
                      >
                        <label className="play-row__toggle">
                          <input
                            type="checkbox"
                            className="rp-sr-only"
                            checked={preset.on}
                            onChange={(e) =>
                              setPreset(name, { on: e.target.checked })
                            }
                          />
                          <span className="play-row__icon" aria-hidden="true">
                            <ActivityIcon icon={activity.icon} size={22} />
                          </span>
                          <span className="rp-row__text">
                            <span className="rp-row__title">{name}</span>
                            {preset.on ? (
                              <span className="rp-row__sub">
                                {preset.level
                                  ? levelLabel[preset.level]
                                  : "Not rated"}
                              </span>
                            ) : null}
                          </span>
                          <span className="play-row__state" aria-hidden="true">
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
            <div className="section-head">
              <h2 id="own-heading">Something else?</h2>
            </div>
            <p className="rp-help profile-form__lede">
              Add up to {maxCustom} activities that aren’t listed.
            </p>
            {draft.custom.length ? (
              <ul className="rp-list" aria-labelledby="own-heading">
                {draft.custom.map((row, index) => {
                  const label = `Your own activity ${index + 1}`;
                  const named = row.name.trim() || label.toLowerCase();
                  return (
                    <li key={row.id} className="rp-row own-row">
                      <div className="own-row__line">
                        <input
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
                className={cx(buttonClass({ variant: "secondary" }), "own-add")}
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
                className="profile-error"
                tabIndex={-1}
              >
                {activityError}
              </p>
            ) : null}
          </section>

          <p className="rp-help profile-form__account">
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
        <div className="discard-choice">
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
