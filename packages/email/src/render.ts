export type EmailKind =
  | "joined_confirmed"
  | "joined_waitlisted"
  | "promoted"
  | "released"
  | "cancelled"
  | "instructions_changed"
  | "reminder";

export interface EmailContext {
  kind: EmailKind;
  title: string;
  startsAt: string;
  timeZone: string;
  link: string;
  firstName: string;
  queuePosition: number | null;
  cutoffAt: string | null;
}

function localTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

function subjectFor(kind: EmailKind): string {
  switch (kind) {
    case "joined_confirmed":
    case "joined_waitlisted":
    case "promoted":
    case "released":
      return "Your RallyPoint place";
    case "cancelled":
    case "instructions_changed":
      return "Session update";
    case "reminder":
      return "Session reminder";
  }
}

function firstLine(c: EmailContext): string {
  switch (c.kind) {
    case "joined_confirmed":
      return `You’re in for ${c.title}.`;
    case "joined_waitlisted":
      return c.queuePosition === null
        ? `You’re on the waitlist for ${c.title}.`
        : `You’re on the waitlist for ${c.title}, number ${c.queuePosition} in line.`;
    case "promoted":
      return `A place opened: you’re now in for ${c.title}.`;
    case "released": {
      const by = c.cutoffAt === null ? "the payment cutoff" : localTime(c.cutoffAt, c.timeZone);
      return `Your spot for ${c.title} went to the waitlist because it wasn’t marked paid by ${by}.`;
    }
    case "cancelled":
      return `${c.title} was cancelled.`;
    case "instructions_changed":
      return `How to pay for ${c.title} has changed.`;
    case "reminder":
      return `${c.title} starts in about 24 hours.`;
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderEmail(c: EmailContext): { subject: string; text: string; html: string } {
  const first = firstLine(c);
  const when = localTime(c.startsAt, c.timeZone);
  const status = "See your current status: ";
  const text = [first, when, `${status}${c.link}`, "RallyPoint"].join("\n\n") + "\n";
  const html = [
    `<p>${escapeHtml(first)}</p>`,
    `<p>${escapeHtml(when)}</p>`,
    `<p>${status}<a href="${escapeHtml(c.link)}">${escapeHtml(c.link)}</a></p>`,
    "<p>RallyPoint</p>",
  ].join("\n");
  return { subject: subjectFor(c.kind), text, html };
}
