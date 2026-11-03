// Areas and courts for ranked play (D-26, WDL-419). Areas are Singapore's
// URA planning areas, grouped by region; a court belongs to one area and is
// shared by everyone. No coordinates: a court is a name, an area and an
// optional Maps link.

/** A planning area; `label` is its everyday name where that differs. */
export interface Area {
  key: string;
  label: string;
}

export interface Region {
  key: string;
  name: string;
  areas: Area[];
}

export interface Court {
  id: string;
  name: string;
  /** The area's key. */
  area: string;
  mapsUrl: string | null;
}

export interface CourtInput {
  area: string;
  name: string;
  mapsLink: string;
}

/** One message per field; the first problem found in that field. */
export interface CourtError {
  field: "area" | "name" | "mapsLink";
  message: string;
}

export const maxCourtName = 60;
const maxLink = 500;
/** The most courts one person can add (pilot ceiling). */
export const maxCourtsPerPerson = 20;

const codePoints = (text: string) => [...text].length;

/** Checks and tidies a new court before it is saved; the server rechecks. */
export function normalizeCourt(
  input: CourtInput,
):
  | { ok: true; value: { area: string; name: string; mapsUrl: string | null } }
  | { ok: false; errors: CourtError[] } {
  const errors: CourtError[] = [];
  const area = input.area.trim();
  if (!area) errors.push({ field: "area", message: "Choose an area." });

  const typed = input.name.trim();
  // Invisible format characters are removed; line breaks are refused.
  const name = typed.replace(/\p{Cf}/gu, "").trim();
  if (/\p{Cc}/u.test(typed) || !/[\p{L}\p{N}]/u.test(name)) {
    errors.push({
      field: "name",
      message: "Name the court with letters or numbers.",
    });
  } else if (codePoints(name) > maxCourtName) {
    errors.push({
      field: "name",
      message: `Use a name of up to ${maxCourtName} characters.`,
    });
  }

  const link = input.mapsLink.trim();
  let mapsUrl: string | null = null;
  if (link) {
    let url: URL | null = null;
    try {
      url = new URL(link);
    } catch {
      url = null;
    }
    if (!url || url.protocol !== "https:" || link.length > maxLink) {
      errors.push({
        field: "mapsLink",
        message: "Use a link that starts with https://.",
      });
    } else mapsUrl = link;
  }

  return errors.length
    ? { ok: false, errors }
    : { ok: true, value: { area, name, mapsUrl } };
}
