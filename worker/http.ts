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
