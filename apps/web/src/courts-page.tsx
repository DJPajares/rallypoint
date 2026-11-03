"use client";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { MapPinIcon } from "@phosphor-icons/react/dist/csr/MapPin";
import {
  Button,
  Field,
  Input,
  Notice,
  SelectField,
  useToast,
} from "@rallypoint/ui";
import { maxCourtName, normalizeCourt } from "@rallypoint/domain/courts";
import type { Court, CourtError, Region } from "@rallypoint/domain/courts";
import { ListSkeleton } from "./skeletons";
import { useApi } from "./use-api";
import { useMutation } from "./use-mutation";

const errorClass = "mt-2 mb-0 text-sm font-medium text-danger-foreground";
const fieldIds: Record<CourtError["field"], string> = {
  area: "court-area",
  name: "court-name",
  mapsLink: "court-link",
};

/**
 * Courts for ranked play (D-26, WDL-419): pick an area to see its courts and
 * add one that's missing. The list is shared by everyone; who added a court
 * isn't shown. Ranked search will link here; until then it's reached by link.
 */
export function CourtsPage() {
  const areas = useApi<{ regions: Region[] }>("/api/areas", true);
  const toast = useToast();
  const [area, setArea] = useState("");
  const [name, setName] = useState("");
  const [link, setLink] = useState("");
  const [errors, setErrors] = useState<CourtError[]>([]);
  const [added, setAdded] = useState(0);
  const add = useMutation<{ court: Court }>(({ court }) => {
    setName("");
    setLink("");
    setAdded((n) => n + 1);
    toast(`${court.name} added.`);
  });
  useEffect(() => {
    document.title = "Courts · RallyPoint";
  }, []);
  const regions = areas.data?.regions ?? [];
  const label = regions
    .flatMap((r) => r.areas)
    .find((a) => a.key === area)?.label;
  const errorFor = (field: CourtError["field"]) =>
    errors.find((e) => e.field === field)?.message;

  function submit(event: FormEvent) {
    event.preventDefault();
    const court = normalizeCourt({ area, name, mapsLink: link });
    if (!court.ok) {
      setErrors(court.errors);
      // Take the person to the first field that needs fixing.
      document.getElementById(fieldIds[court.errors[0].field])?.focus();
      return;
    }
    setErrors([]);
    add.run("/api/courts", {
      area: court.value.area,
      name: court.value.name,
      mapsLink: court.value.mapsUrl ?? "",
    });
  }

  return (
    <section className="mx-auto max-w-160" aria-labelledby="courts-title">
      <div className="mb-4">
        <h1 id="courts-title">Courts</h1>
      </div>
      {areas.error ? (
        <Notice retry={areas.retry}>{areas.error}</Notice>
      ) : (
        <Field id="court-area" label="Area">
          <SelectField
            id="court-area"
            value={area}
            onChange={(next) => {
              setArea(next);
              setErrors(errors.filter((e) => e.field !== "area"));
            }}
            placeholder={areas.loading ? "Loading areas…" : "Choose an area"}
            disabled={areas.loading}
            aria-describedby={errorFor("area") ? "court-area-error" : undefined}
            groups={regions.map((r) => ({
              label: r.name,
              options: r.areas.map((a) => ({ value: a.key, label: a.label })),
            }))}
          />
          {errorFor("area") ? (
            <p id="court-area-error" className={errorClass}>
              {errorFor("area")}
            </p>
          ) : null}
        </Field>
      )}

      {area && label ? (
        <CourtList area={area} label={label} refreshKey={String(added)} />
      ) : null}

      {area && label ? (
        <form noValidate onSubmit={submit} className="mt-8">
          <h2 className="mb-3">Add a court in {label}</h2>
          <fieldset
            disabled={add.busy}
            className="m-0 min-w-0 rounded-lg border border-border bg-card p-5"
          >
            <Field id="court-name" label="Court name">
              <Input
                id="court-name"
                value={name}
                maxLength={maxCourtName * 2}
                autoComplete="off"
                onChange={(e) => setName(e.target.value)}
                aria-invalid={errorFor("name") ? true : undefined}
                aria-describedby={
                  errorFor("name") ? "court-name-error" : undefined
                }
              />
              {errorFor("name") ? (
                <p id="court-name-error" className={errorClass}>
                  {errorFor("name")}
                </p>
              ) : null}
            </Field>
            <Field
              id="court-link"
              label="Maps link (optional)"
              help="Paste the link from Google Maps or Apple Maps."
            >
              <Input
                id="court-link"
                type="url"
                inputMode="url"
                value={link}
                autoComplete="off"
                onChange={(e) => setLink(e.target.value)}
                aria-invalid={errorFor("mapsLink") ? true : undefined}
                aria-describedby={
                  errorFor("mapsLink")
                    ? "court-link-error court-link-help"
                    : "court-link-help"
                }
              />
              {errorFor("mapsLink") ? (
                <p id="court-link-error" className={errorClass}>
                  {errorFor("mapsLink")}
                </p>
              ) : null}
            </Field>
            {add.error ? (
              <p role="alert" className={errorClass}>
                {add.error}
              </p>
            ) : null}
            {add.recovery}
            <Button type="submit" variant="primary" className="mt-2">
              {add.busy ? "Adding…" : "Add court"}
            </Button>
          </fieldset>
        </form>
      ) : null}
    </section>
  );
}

function CourtList({
  area,
  label,
  refreshKey,
}: {
  area: string;
  label: string;
  refreshKey: string;
}) {
  const courts = useApi<{ courts: Court[] }>(
    `/api/courts?area=${encodeURIComponent(area)}`,
    false,
    refreshKey,
  );
  return (
    <section aria-labelledby="court-list-title" className="mt-6">
      <h2 id="court-list-title" className="mb-3">
        Courts in {label}
      </h2>
      {courts.loading ? (
        <ListSkeleton label="Loading courts…" rows={2} />
      ) : courts.error ? (
        <Notice retry={courts.retry}>{courts.error}</Notice>
      ) : courts.data?.courts.length ? (
        <ul className="m-0 list-none overflow-hidden rounded-lg bg-card p-0 shadow-sm">
          {courts.data.courts.map((c) => (
            <li
              key={c.id}
              className="flex min-h-14 items-center justify-between gap-3 border-t border-border px-4 py-2 first:border-t-0"
            >
              <span className="min-w-0 font-semibold wrap-anywhere">
                {c.name}
              </span>
              {c.mapsUrl ? (
                <a
                  href={c.mapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-touch flex-none items-center gap-1 text-sm font-medium"
                >
                  <MapPinIcon size={16} aria-hidden="true" />
                  Open in Maps
                  <span className="sr-only">: {c.name}</span>
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0 text-muted-foreground">
          No courts listed in {label} yet.
        </p>
      )}
    </section>
  );
}
