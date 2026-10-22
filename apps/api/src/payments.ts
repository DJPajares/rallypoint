import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { ApiError, json, parse, readBody, uuid, uuidParam } from "./http";
import type { ApiEnv } from "./identity";
import { displayName, notAvailable, requireUser } from "./identity";

const bucket = "payment-qr";
const maxBytes = 1024 * 1024;
const startsWith = (bytes: Uint8Array, prefix: number[], at = 0) =>
  bytes.length >= at + prefix.length && prefix.every((b, i) => bytes[at + i] === b);
const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));
// The declared type must match the file's own signature. Anything else,
// including SVG or HTML renamed to an image, is refused before storage.
const signatures: Record<string, (bytes: Uint8Array) => boolean> = {
  "image/png": (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  "image/jpeg": (b) => startsWith(b, [0xff, 0xd8, 0xff]),
  "image/webp": (b) => startsWith(b, ascii("RIFF")) && startsWith(b, ascii("WEBP"), 8),
};

const conflicts: Record<string, string> = {
  stale_payment_instructions:
    "These payment instructions changed since you loaded them. Refresh to see the latest, then try again.",
  instructions_required:
    "Add written payment instructions first, so people can still pay if the image doesn’t load.",
  session_closed:
    "This session is cancelled, so its payment instructions can’t be changed.",
  idempotency_conflict:
    "This request key was already used for different details.",
};
type Result = {
  operationKey?: string;
  revision: number;
  paymentInstructions: unknown;
  imagePath: string | null;
  removedPath?: string | null;
};

async function rpc<T>(
  c: Context<ApiEnv>,
  name: string,
  args: Record<string, unknown>,
  denied = new ApiError(
    403,
    "group_access_denied",
    "Only this session’s organizers can change payment instructions.",
  ),
) {
  const { data, error } = await c.var.db
    .schema("api")
    .rpc(name, { p_actor_id: c.var.user.id, ...args });
  if (error) {
    if (error.code === "42501") throw denied;
    if (conflicts[error.message])
      throw new ApiError(409, error.message, conflicts[error.message]);
    if (error.code === "23514")
      throw new ApiError(
        422,
        "invalid_payment_instructions",
        "Enter payment instructions of 1 to 1,000 characters.",
      );
    throw new ApiError(
      503,
      "service_unavailable",
      "The action could not be confirmed. Refresh to check whether it saved.",
    );
  }
  return data as T;
}

/** Never send storage paths to a browser. */
const respond = ({ imagePath: _, removedPath: __, ...result }: Result) =>
  json(result);

/** Best effort: a committed write never fails because cleanup did. */
async function cleanUp(c: Context<ApiEnv>, session: string, keep: string | null, remove: Array<string | null | undefined>) {
  const files = c.var.db.storage.from(bucket);
  try {
    const paths = remove.filter((p): p is string => !!p && p !== keep);
    if (paths.length) await files.remove(paths);
    // Sweep leftovers from crashed requests, never a just-uploaded object
    // whose own request may still be committing.
    const { data } = await files.list(session);
    const stale = (data ?? [])
      .filter(
        (o) =>
          `${session}/${o.name}` !== keep &&
          Date.now() - Date.parse(o.created_at) > 10 * 60_000,
      )
      .map((o) => `${session}/${o.name}`);
    if (stale.length) await files.remove(stale);
  } catch {
    // Unreferenced objects are unreadable; the next write sweeps them.
  }
}

async function readImage(request: Request) {
  const type = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
  const invalid = new ApiError(
    422,
    "invalid_image",
    "Choose a PNG, JPEG or WebP image of the payment QR code.",
  );
  const tooLarge = new ApiError(
    413,
    "image_too_large",
    "The image is larger than 1 MB. Choose a smaller image.",
  );
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    // Keep reading (not storing) a little past the limit, so a slightly
    // oversized upload gets this message instead of a reset connection.
    if (size > 2 * maxBytes) {
      await reader.cancel();
      throw tooLarge;
    }
    if (size <= maxBytes) chunks.push(value);
  }
  if (size > maxBytes) throw tooLarge;
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  if (!signatures[type]?.(bytes)) throw invalid;
  return { type, bytes };
}

const key = z.string().regex(uuid);
const revision = z.coerce.number().int().min(0);
const change = z.discriminatedUnion("action", [
  z.object({
    operationKey: key,
    revision,
    action: z.literal("save"),
    text: z.string().trim().min(1).max(1000),
  }),
  z.object({
    operationKey: key,
    revision,
    action: z.enum(["remove_image", "remove"]),
  }),
]);
const upload = z.object({ operationKey: key, revision });

const base = `/sessions/:id{${uuidParam}}/payment-instructions`;
export const payments = new Hono<ApiEnv>()
  .get(base, requireUser, async (c) =>
    json(
      await rpc<unknown>(c, "read_payment_instructions", {
        p_session_id: c.req.param("id"),
      }),
    ),
  )
  .post(base, requireUser, async (c) => {
    const b = parse(
      change,
      await readBody(c.req.raw),
      "invalid_payment_instructions",
      "Enter payment instructions of 1 to 1,000 characters.",
    );
    const result = await rpc<Result>(c, "update_payment_instructions", {
      p_actor_name: displayName(c.var.user, "Organizer"),
      p_key: b.operationKey,
      p_session_id: c.req.param("id"),
      p_revision: b.revision,
      p_action: b.action,
      p_body: b.action === "save" ? b.text : null,
      p_image_path: null,
      p_image_type: null,
      p_image_bytes: null,
      p_image_sha256: null,
    });
    await cleanUp(c, c.req.param("id"), result.imagePath, [result.removedPath]);
    return respond(result);
  })
  .all(base, requireUser, () => notAvailable())
  .post(`${base}/qr`, requireUser, async (c) => {
    const session = c.req.param("id");
    const q = parse(
      upload,
      c.req.query(),
      "invalid_input",
      "A valid request key and revision are required.",
    );
    const image = await readImage(c.req.raw);
    // Refuse non-organizers, stale tabs and missing text before storing a file.
    const current = await rpc<Result>(c, "read_payment_instructions", {
      p_session_id: session,
    });
    const replay = await c.var.db
      .schema("api")
      .rpc("read_operation", { p_actor_id: c.var.user.id, p_key: q.operationKey });
    if (!replay.data) {
      if (current.revision !== q.revision)
        throw new ApiError(409, "stale_payment_instructions", conflicts.stale_payment_instructions);
      if (!current.paymentInstructions)
        throw new ApiError(409, "instructions_required", conflicts.instructions_required);
    }
    const hash = [
      ...new Uint8Array(await crypto.subtle.digest("SHA-256", image.bytes)),
    ]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const path = `${session}/${crypto.randomUUID()}`;
    const files = c.var.db.storage.from(bucket);
    const stored = await files.upload(path, image.bytes, {
      contentType: image.type,
      upsert: false,
    });
    if (stored.error)
      throw new ApiError(
        503,
        "service_unavailable",
        "The image could not be saved. Please try again.",
      );
    let result: Result;
    try {
      result = await rpc<Result>(c, "update_payment_instructions", {
        p_actor_name: displayName(c.var.user, "Organizer"),
        p_key: q.operationKey,
        p_session_id: session,
        p_revision: q.revision,
        p_action: "set_image",
        p_body: null,
        p_image_path: path,
        p_image_type: image.type,
        p_image_bytes: image.bytes.length,
        p_image_sha256: hash,
      });
    } catch (error) {
      await cleanUp(c, session, null, [path]);
      throw error;
    }
    // A replay returns the first attempt's image; this attempt's copy goes.
    await cleanUp(c, session, result.imagePath, [path, result.removedPath]);
    return respond(result);
  })
  .all(`${base}/qr`, requireUser, () => notAvailable())
  .get(`/registrations/:slug{${uuidParam}}/payment-qr`, requireUser, async (c) => {
    const image = await rpc<{ path: string; type: string } | null>(
      c,
      "read_payment_qr",
      { p_slug: c.req.param("slug") },
      new ApiError(
        403,
        "payment_instructions_unavailable",
        "Payment details are shown only to people booked in this session.",
      ),
    );
    const missing = new ApiError(
      404,
      "payment_qr_unavailable",
      "There is no payment QR image. Use the written instructions.",
    );
    if (!image) throw missing;
    const { data, error } = await c.var.db.storage.from(bucket).download(image.path);
    if (error || !data) throw missing;
    return new Response(data.stream(), {
      headers: {
        "Content-Type": image.type,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Content-Disposition": "inline",
      },
    });
  })
  .all(`/registrations/:slug{${uuidParam}}/payment-qr`, requireUser, () =>
    notAvailable(),
  );
