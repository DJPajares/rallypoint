/**
 * Copies the payment instructions and QR of a session the organizer runs
 * again (P-22), using the same endpoints the organizer would use by hand.
 * Returns false when anything failed, so the page can ask the organizer to
 * add the details themselves; the new session is never undone.
 */
export async function copyPaymentDetails(
  token: string,
  from: { id: string; slug: string },
  toId: string,
): Promise<boolean> {
  const auth = { Authorization: `Bearer ${token}` };
  const call = (path: string, init: RequestInit = {}, ms = 10000) =>
    fetch(path, {
      ...init,
      headers: { ...auth, ...init.headers },
      signal: AbortSignal.timeout(ms),
    });
  try {
    const source = await call(`/api/sessions/${from.id}/payment-instructions`);
    if (!source.ok) return false;
    const { paymentInstructions } = (await source.json()) as {
      paymentInstructions: { text: string; hasImage: boolean } | null;
    };
    if (!paymentInstructions) return true;
    const saved = await call(`/api/sessions/${toId}/payment-instructions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operationKey: crypto.randomUUID(),
        revision: 0,
        action: "save",
        text: paymentInstructions.text,
      }),
    });
    if (!saved.ok) return false;
    if (!paymentInstructions.hasImage) return true;
    const { revision } = (await saved.json()) as { revision: number };
    const image = await call(`/api/registrations/${from.slug}/payment-qr`);
    if (!image.ok) return false;
    const blob = await image.blob();
    const uploaded = await call(
      `/api/sessions/${toId}/payment-instructions/qr?operationKey=${crypto.randomUUID()}&revision=${revision}`,
      { method: "POST", headers: { "Content-Type": blob.type }, body: blob },
      20000,
    );
    return uploaded.ok;
  } catch {
    return false;
  }
}
