"use client";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { presetActivities, presetFor } from "@rallypoint/domain/activities";
import {
  levelLabel,
  normalizeProfile,
  skillLevels,
} from "@rallypoint/domain/profile";
import type {
  MyProfile,
  ProfileActivity,
  ProfileError,
  SkillLevel,
} from "@rallypoint/domain/profile";
import {
  buttonClass,
  CheckField,
  Field,
  Notice,
  Pending,
  Sheet,
} from "@rallypoint/ui";
import { useAuth } from "./auth-context";
import { useApi } from "./use-api";
import { DetailPage, StickyActions } from "./ui";

const maxCustom = 3;

type Level = "" | SkillLevel;
interface Draft {
  name: string;
  presets: Record<string, { on: boolean; level: Level }>;
  custom: Array<{ id: number; name: string; level: Level }>;
}

const asLevel = (level: SkillLevel | null): Level => level ?? "";

function startingDraft(profile: MyProfile): Draft {
  const draft: Draft = {
    name: profile.nameIsCustom ? profile.name : "",
    presets: Object.fromEntries(
      presetActivities.map((name) => [name, { on: false, level: "" as Level }]),
    ),
    custom: [],
  };
  for (const activity of profile.activities) {
    const preset = presetFor(activity.name);
    if (preset)
      draft.presets[preset] = { on: true, level: asLevel(activity.level) };
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
    ...presetActivities
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

// The name an account shows when no profile name is set; mirrors the server.
function accountNameOf(
  user: { email?: string; user_metadata: Record<string, unknown> } | undefined,
) {
  return (
    String(
      user?.user_metadata.full_name ?? user?.email?.split("@")[0] ?? "",
    ).trim() || "Participant"
  );
}

function LevelSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Level;
  onChange: (value: Level) => void;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value as Level)}
    >
      <option value="">No level</option>
      {skillLevels.map((level) => (
        <option key={level} value={level}>
          {levelLabel[level]}
        </option>
      ))}
    </select>
  );
}

export function EditProfile() {
  const profile = useApi<{ profile: MyProfile }>("/api/me/profile");
  if (profile.loading)
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
  return <EditForm profile={profile.data.profile} />;
}

function EditForm({ profile }: { profile: MyProfile }) {
  const { session } = useAuth();
  const router = useRouter();
  const [initial] = useState(() => startingDraft(profile));
  const [draft, setDraft] = useState(initial);
  const [errors, setErrors] = useState<ProfileError[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const focus = useRef<string | null>(null);
  const nextId = useRef(initial.custom.length);
  const nameInput = useRef<HTMLInputElement>(null);
  const activitiesError = useRef<HTMLParagraphElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const dirty = snapshot(draft) !== snapshot(initial);
  const nameError = errors.find((e) => e.field === "name")?.message;
  const activityError = errors.find((e) => e.field === "activities")?.message;
  const accountName = accountNameOf(session?.user);

  // Focus lands after the render that makes its target exist.
  useEffect(() => {
    const target = focus.current;
    if (!target) return;
    focus.current = null;
    if (target === "name") nameInput.current?.focus();
    else if (target === "activities") activitiesError.current?.focus();
    else if (target === "add") addButton.current?.focus();
    else document.getElementById(target)?.focus();
  });

  function showErrors(next: ProfileError[]) {
    setErrors(next);
    focus.current = next.some((e) => e.field === "name")
      ? "name"
      : "activities";
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setProblem(null);
    const result = normalizeProfile({
      name: draft.name,
      activities: activitiesOf(draft),
    });
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
          name: result.value.name ?? "",
          activities: result.value.activities,
        }),
        signal: AbortSignal.timeout(10000),
      });
      const body = await response.json();
      if (response.ok) {
        router.push("/profile");
        return;
      }
      if (Array.isArray(body.errors) && body.errors.length)
        showErrors(body.errors as ProfileError[]);
      else setProblem(body.error?.message ?? "Please try again.");
    } catch {
      setProblem(
        "The connection was interrupted. Your changes are still here; save again to be sure.",
      );
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
    <DetailPage back="/profile" backLabel="Profile" className="form-page">
      <div className="page-head">
        <h1>Edit profile</h1>
      </div>
      <form className="rp-card" noValidate onSubmit={save}>
        <fieldset disabled={busy}>
          <Field
            id="profile-name"
            label="Name"
            help={`Leave blank to use ${accountName}.`}
          >
            <input
              ref={nameInput}
              id="profile-name"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              autoComplete="nickname"
              aria-invalid={nameError ? true : undefined}
              aria-describedby={
                nameError
                  ? "profile-name-error profile-name-help"
                  : "profile-name-help"
              }
            />
            {nameError ? (
              <p id="profile-name-error" className="profile-error">
                {nameError}
              </p>
            ) : null}
          </Field>
          <fieldset
            className="profile-activities"
            aria-describedby={
              activityError
                ? "activities-error activities-help"
                : "activities-help"
            }
          >
            <legend className="rp-field__label">Activities</legend>
            {presetActivities.map((name) => {
              const preset = draft.presets[name]!;
              return (
                <div key={name} className="activity-row">
                  <CheckField
                    checked={preset.on}
                    onCheckedChange={(on) => setPreset(name, { on })}
                  >
                    {name}
                  </CheckField>
                  {preset.on ? (
                    <LevelSelect
                      label={`${name} level`}
                      value={preset.level}
                      onChange={(level) => setPreset(name, { level })}
                    />
                  ) : null}
                </div>
              );
            })}
            <div role="group" aria-label="Your own activities">
              {draft.custom.map((row, index) => (
                <div key={row.id} className="activity-row activity-row--own">
                  <input
                    id={`custom-${row.id}`}
                    aria-label={`Your own activity ${index + 1}`}
                    aria-invalid={activityError ? true : undefined}
                    value={row.name}
                    onChange={(e) =>
                      setCustom(row.id, { name: e.target.value })
                    }
                  />
                  <LevelSelect
                    label={`${row.name.trim() || `Your own activity ${index + 1}`} level`}
                    value={row.level}
                    onChange={(level) => setCustom(row.id, { level })}
                  />
                  <button
                    type="button"
                    className={buttonClass({ variant: "link" })}
                    aria-label={`Remove ${row.name.trim() || `your own activity ${index + 1}`}`}
                    onClick={() => removeCustom(row.id)}
                  >
                    Remove
                  </button>
                </div>
              ))}
              {draft.custom.length < maxCustom ? (
                <button
                  ref={addButton}
                  type="button"
                  className={buttonClass({ variant: "secondary" })}
                  onClick={addCustom}
                >
                  <PlusIcon size={18} aria-hidden="true" />
                  Add your own
                </button>
              ) : null}
            </div>
            <p id="activities-help" className="rp-help">
              Your own rating.
            </p>
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
          </fieldset>
          <p className="rp-help">Anyone with your profile link can see this.</p>
          <p className="rp-help">
            Signed in as {session?.user.email ?? "your account"}
          </p>
          {problem ? <Notice>{problem}</Notice> : null}
          <StickyActions>
            <button
              type="submit"
              className={buttonClass({ variant: "primary" })}
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
