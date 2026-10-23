import type { SupabaseClient } from "@supabase/supabase-js";
import { renderEmail, type EmailContext, type EmailKind } from "./render.ts";
import type { Provider, SendResult } from "./provider.ts";

export const DEFAULT_FROM = "RallyPoint <no-reply@auth.wndrhive.com>";
const BATCH = 5;

export interface DrainOptions {
  /** A service-role client already pointed at the API schema. */
  db: SupabaseClient<any, any, any>;
  admin: SupabaseClient<any, any, any>["auth"]["admin"];
  provider: Provider | null;
  from: string;
  appOrigin: string;
  holder?: string;
  sleep?: (ms: number) => Promise<void>;
}

export interface DrainResult {
  leased: boolean;
  sent: number;
  retried: number;
  ended: number;
  skipped: number;
}

interface ClaimedJob {
  id: string;
  kind: EmailKind;
  attempts: number;
  userId: string;
  idempotencyKey: string;
  context: {
    title: string;
    startsAt: string;
    timeZone: string;
    slug: string;
    firstName: string | null;
    queuePosition: number | null;
    cutoffAt: string | null;
  };
}

interface Payload {
  to: string;
  from: string;
  subject: string;
  text: string;
  html: string;
}

type Outcome = "accepted" | "transient" | "ambiguous" | "permanent" | "quota" | "recipient_missing";

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function isMissing(error: { status?: number; code?: string }): boolean {
  return error.status === 404 || error.code === "user_not_found";
}

/**
 * One scheduled pass: lease up to five due jobs, send each through the provider one
 * at a time, and record what happened. Nothing here logs an address, a body or a
 * provider answer; the only output is a count line.
 */
export async function drainEmail(o: DrainOptions): Promise<DrainResult> {
  const holder = o.holder ?? crypto.randomUUID();
  const sleep = o.sleep ?? wait;
  const result: DrainResult = { leased: false, sent: 0, retried: 0, ended: 0, skipped: 0 };
  const call = async (name: string, args: Record<string, unknown>): Promise<unknown> => {
    const { data, error } = await o.db.rpc(name, args);
    if (error) throw new Error(`${name} failed`);
    return data;
  };
  // With delivery off nothing may move to "sending", so no job is taken.
  const claimed = (await call("claim_email_jobs", {
    p_holder: holder,
    p_limit: o.provider === null ? 0 : BATCH,
  })) as { leased: boolean; jobs: ClaimedJob[] };
  if (!claimed.leased) return result;
  result.leased = true;
  try {
    if (o.provider === null) {
      result.ended = Number(await call("disable_due_emails", { p_holder: holder }));
      return result;
    }
    for (const job of claimed.jobs) {
      try {
        await runJob(job);
      } catch {
        // The job stays leased; if it had begun, the next settle treats it as unknown.
        result.skipped += 1;
      }
    }
    return result;
  } finally {
    try {
      await call("release_email_sender", { p_holder: holder });
    } catch {
      // The lease runs out by itself within two minutes.
    }
    console.info(
      `email drain: sent=${result.sent} retried=${result.retried} ended=${result.ended} skipped=${result.skipped}`,
    );
  }

  async function finish(
    job: ClaimedJob,
    outcome: Outcome,
    code: string | null,
    providerId: string | null,
    retryAfter: number | null,
  ): Promise<void> {
    await call("finish_email_attempt", {
      p_holder: holder,
      p_job: job.id,
      p_outcome: outcome,
      p_code: code,
      p_provider_id: providerId,
      p_retry_after_seconds: retryAfter,
    });
  }

  async function runJob(job: ClaimedJob): Promise<void> {
    const provider = o.provider as Provider;
    let user: { email?: string; email_confirmed_at?: string } | null = null;
    try {
      const { data, error } = await o.admin.getUserById(job.userId);
      if (error && !isMissing(error)) throw new Error("lookup failed");
      user = error ? null : data.user;
    } catch {
      result.skipped += 1;
      return;
    }
    if (user === null || !user.email_confirmed_at || !user.email) {
      await finish(job, "recipient_missing", null, null, null);
      result.ended += 1;
      return;
    }
    const c = job.context;
    const context: EmailContext = {
      kind: job.kind,
      title: c.title,
      startsAt: c.startsAt,
      timeZone: c.timeZone,
      link: `${o.appOrigin.replace(/\/+$/, "")}/s/${c.slug}`,
      firstName: c.firstName ?? "",
      queuePosition: c.queuePosition,
      cutoffAt: c.cutoffAt,
    };
    let fresh: Payload;
    try {
      fresh = { to: user.email, from: o.from, ...renderEmail(context) };
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      // A time that cannot be shown will not become showable by retrying.
      await finish(job, "permanent", "render_failed", null, null);
      result.ended += 1;
      return;
    }
    // The fresh payload only proves the address; what is sent is what begin froze.
    const begun = (await call("begin_email_attempt", {
      p_holder: holder,
      p_job: job.id,
      p_payload: fresh,
    })) as { go: boolean; payload: Payload | null; waitMs: number };
    if (!begun.go || begun.payload === null) {
      result.skipped += 1;
      return;
    }
    await sleep(begun.waitMs);
    const frozen = begun.payload;
    let answer: SendResult;
    try {
      answer = await provider.send({
        from: frozen.from,
        to: frozen.to,
        subject: frozen.subject,
        text: frozen.text,
        html: frozen.html,
        idempotencyKey: job.idempotencyKey,
      });
    } catch {
      // A thrown send may have left the machine: unknown, never "not delivered".
      answer = { outcome: "ambiguous", code: "network" };
    }
    const lastAttempt = job.attempts + 1 >= 3;
    switch (answer.outcome) {
      case "accepted":
        await finish(job, "accepted", null, answer.id, null);
        result.sent += 1;
        break;
      case "transient":
        await finish(job, "transient", answer.code, null, answer.retryAfterSeconds ?? null);
        if (lastAttempt) result.ended += 1;
        else result.retried += 1;
        break;
      case "ambiguous":
        await finish(job, "ambiguous", answer.code, null, null);
        if (lastAttempt) result.ended += 1;
        else result.retried += 1;
        break;
      case "quota":
        await finish(job, "quota", answer.code, null, null);
        if (lastAttempt) result.ended += 1;
        else result.retried += 1;
        break;
      case "permanent":
        await finish(job, "permanent", answer.code, null, null);
        result.ended += 1;
        break;
    }
  }
}
