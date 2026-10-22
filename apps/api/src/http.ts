import type { z } from "zod";
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export const json = (data: unknown, status = 200) =>
  Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
export const errorJson = (error: ApiError) =>
  json({ error: { code: error.code, message: error.message } }, error.status);

/** Any letter case, as the routes have always accepted. */
export const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
/** The same shape as a Hono path-parameter pattern (no capture groups). */
export const uuidParam =
  "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";

/**
 * Validate input with a Zod schema. Every failure for one request maps to that
 * request's single 422 code and message, so clients see the same wording no
 * matter which field was wrong.
 */
export function parse<T extends z.ZodType>(
  schema: T,
  value: unknown,
  code: string,
  message: string,
): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw new ApiError(422, code, message);
  return result.data;
}

/** A JSON object body of at most 16 KiB. */
export async function readBody(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new ApiError(415, "json_required", "Send JSON details.");
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, "invalid_input", "Enter the details.");
  let text = "",
    size = 0;
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 16384) {
        await reader.cancel();
        throw new ApiError(413, "too_large", "The details are too long.");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    const result = JSON.parse(text);
    if (!result || typeof result !== "object" || Array.isArray(result))
      throw Error();
    return result as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, "invalid_input", "Check the submitted details.");
  }
}

// workerd can reset the local proxy connection when a rejected request still
// has an unread body (cloudflare/workerd#7634). Discard only a bounded amount,
// without parsing or executing it, so small auth/method errors stay truthful.
export async function discardRejectedBody(request: Request) {
  if (!request.body || request.bodyUsed) return;
  const reader = request.body.getReader();
  const timer = setTimeout(() => void reader.cancel().catch(() => {}), 1000);
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 16384) {
        await reader.cancel();
        break;
      }
    }
  } catch {
    // A rejected/disconnected request must keep its original error semantics.
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
}
