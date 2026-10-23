export type SendResult =
  | { outcome: "accepted"; id: string }
  | { outcome: "transient"; retryAfterSeconds?: number; code: string }
  | { outcome: "ambiguous"; code: "timeout" | "network" }
  | { outcome: "permanent"; code: string }
  | { outcome: "quota"; code: "daily_quota" | "monthly_quota" };

export interface OutgoingEmail {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  idempotencyKey: string;
}

export interface Provider {
  send(m: OutgoingEmail): Promise<SendResult>;
}

const DEFAULT_TIMEOUT_MS = 10000;

type Raw = { status: number; headers: Headers; json: unknown };

// Runs one request and reads its JSON body under a single deadline. The body is only
// parsed for a field name or id; it is never returned, logged or kept.
async function request(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Raw | "timeout" | "network"> {
  const signal = AbortSignal.timeout(timeoutMs);
  const deadline = new Promise<"timeout">((resolve) => {
    signal.addEventListener("abort", () => resolve("timeout"), { once: true });
  });
  const run = (async (): Promise<Raw | "network"> => {
    try {
      const response = await fetchImpl(url, { ...init, signal });
      let json: unknown = null;
      try {
        json = await response.json();
      } catch {
        json = null;
      }
      return { status: response.status, headers: response.headers, json };
    } catch {
      return "network";
    }
  })();
  const result = await Promise.race([run, deadline]);
  if (result === "network" && signal.aborted) return "timeout";
  return result;
}

function field(json: unknown, key: string): string | undefined {
  if (typeof json !== "object" || json === null) return undefined;
  const value = (json as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

function retryAfter(headers: Headers): number | undefined {
  const raw = headers.get("retry-after");
  if (raw === null || !/^\d+$/.test(raw.trim())) return undefined;
  return Number(raw.trim());
}

export function resendProvider(o: {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): Provider {
  const baseUrl = (o.baseUrl ?? "https://api.resend.com").replace(/\/+$/, "");
  return {
    async send(m) {
      const raw = await request(
        o.fetch ?? fetch,
        `${baseUrl}/emails`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${o.apiKey}`,
            "Content-Type": "application/json",
            "Idempotency-Key": m.idempotencyKey,
          },
          body: JSON.stringify({
            from: m.from,
            to: m.to,
            subject: m.subject,
            text: m.text,
            html: m.html,
          }),
        },
        o.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      );
      if (raw === "timeout" || raw === "network") return { outcome: "ambiguous", code: raw };
      const { status, headers, json } = raw;
      if (status >= 200 && status < 300) {
        return { outcome: "accepted", id: field(json, "id") ?? "" };
      }
      const name = field(json, "name");
      if (name === "daily_quota_exceeded") return { outcome: "quota", code: "daily_quota" };
      if (name === "monthly_quota_exceeded") return { outcome: "quota", code: "monthly_quota" };
      if (status === 429) {
        const seconds = retryAfter(headers);
        return seconds === undefined
          ? { outcome: "transient", code: "rate_limited" }
          : { outcome: "transient", code: "rate_limited", retryAfterSeconds: seconds };
      }
      if (status === 409 && name === "concurrent_idempotent_requests") {
        return { outcome: "transient", code: "concurrent_idempotent" };
      }
      if (status >= 500 || status === 408) return { outcome: "transient", code: `http_${status}` };
      return { outcome: "permanent", code: name ?? `http_${status}` };
    },
  };
}

function parseFrom(from: string): { Email: string; Name?: string } {
  const match = /^\s*(.*?)\s*<([^<>]+)>\s*$/.exec(from);
  if (match === null) return { Email: from.trim() };
  const name = match[1].replace(/^"(.*)"$/, "$1");
  return name === "" ? { Email: match[2] } : { Email: match[2], Name: name };
}

export function mailpitProvider(o: {
  baseUrl: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): Provider {
  const baseUrl = o.baseUrl.replace(/\/+$/, "");
  return {
    async send(m) {
      const raw = await request(
        o.fetch ?? fetch,
        `${baseUrl}/api/v1/send`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            From: parseFrom(m.from),
            To: [{ Email: m.to }],
            Subject: m.subject,
            Text: m.text,
            HTML: m.html,
          }),
        },
        o.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      );
      if (raw === "timeout" || raw === "network") return { outcome: "ambiguous", code: raw };
      if (raw.status >= 200 && raw.status < 300) {
        return { outcome: "accepted", id: field(raw.json, "ID") ?? "" };
      }
      return raw.status >= 500
        ? { outcome: "transient", code: `http_${raw.status}` }
        : { outcome: "permanent", code: `http_${raw.status}` };
    },
  };
}
