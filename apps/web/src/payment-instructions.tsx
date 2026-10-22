"use client";
import { useEffect, useRef, useState } from "react";
import { buttonClass, Field, Notice, Pending } from "@rallypoint/ui";
import type {
  ManagedPaymentInstructions,
  PaymentInstructions,
} from "@rallypoint/domain/registration";
import { useAuth } from "./auth-context";
import { useApi } from "./use-api";
import { useMutation } from "./use-mutation";

const outside =
  "Pay the organizer directly. RallyPoint doesn’t process or confirm payments.";
const imageTypes = ["image/png", "image/jpeg", "image/webp"];

/**
 * The QR is private: it is fetched with the viewer's own sign-in and shown
 * from memory, so no image address can be shared or cached. Any failure
 * leaves the written instructions as the way to pay.
 */
function useQrImage(slug: string, revision: number | null) {
  const { session } = useAuth();
  const token = session?.access_token ?? "";
  const key = `${slug}:${revision}:${token}`;
  const [state, setState] = useState({
    key: "",
    url: null as string | null,
    failed: false,
  });
  useEffect(() => {
    if (revision === null || !token) return;
    const controller = new AbortController();
    let url: string | null = null;
    void fetch(`/api/registrations/${slug}/payment-qr`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
    })
      .then(async (response) => {
        const blob = await response.blob();
        if (!response.ok || !imageTypes.includes(blob.type)) throw Error();
        url = URL.createObjectURL(blob);
        if (!controller.signal.aborted) setState({ key, url, failed: false });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setState({ key, url: null, failed: true });
      });
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [key, slug, revision, token]);
  const current = state.key === key ? state : { url: null, failed: false };
  return {
    ...current,
    fail: () => setState({ key, url: null, failed: true }),
  };
}

function QrImage({ slug, revision }: { slug: string; revision: number }) {
  const image = useQrImage(slug, revision);
  if (image.failed)
    return (
      <p className="rp-help">
        The QR image couldn’t load. Use the instructions above.
      </p>
    );
  if (!image.url) return <Pending>Loading QR image…</Pending>;
  return (
    // An object URL from memory; next/image can't optimize it.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="payment-qr"
      src={image.url}
      alt="Payment QR code"
      onError={image.fail}
    />
  );
}

/** For the organizer and the session's confirmed or waitlisted people. */
export function HowToPay({
  slug,
  instructions,
}: {
  slug: string;
  instructions: PaymentInstructions;
}) {
  return (
    <section className="rp-card how-to-pay" aria-labelledby="how-to-pay">
      <h2 id="how-to-pay">How to pay</h2>
      <p className="payment-text">{instructions.text}</p>
      {instructions.hasImage ? (
        <QrImage slug={slug} revision={instructions.imageRevision} />
      ) : null}
      <p className="rp-help">{outside}</p>
    </section>
  );
}

type Saved = ManagedPaymentInstructions & { operationKey?: string };

/** Separate from the session details, so it stays editable after people book. */
export function PaymentInstructionsEditor({
  sessionId,
  slug,
}: {
  sessionId: string;
  slug: string;
}) {
  const { session } = useAuth();
  const path = `/api/sessions/${sessionId}/payment-instructions`;
  const loaded = useApi<ManagedPaymentInstructions>(path);
  // A write's result applies until the next load of the server record.
  const [saved, setSavedFor] = useState<{
    base: ManagedPaymentInstructions | null;
    value: Saved;
  } | null>(null);
  const setSaved = (value: Saved | null) =>
    setSavedFor(value ? { base: loaded.data, value } : null);
  const [text, setText] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const confirmation = useRef("");
  const mutation = useMutation<Saved>((value) => {
    setSaved(value);
    setText(value.paymentInstructions?.text ?? "");
    setStatus(confirmation.current);
  });
  const current =
    saved && saved.base === loaded.data ? saved.value : loaded.data;
  if (!current)
    return loaded.error ? (
      <Notice retry={loaded.retry}>{loaded.error}</Notice>
    ) : (
      <Pending>Loading payment instructions…</Pending>
    );
  const instructions = current.paymentInstructions;
  const draft = text ?? instructions?.text ?? "";
  const busy = mutation.busy || mutation.uncertain || uploading;
  function change(action: "save" | "remove" | "remove_image", done: string) {
    setStatus("");
    setUploadError(null);
    confirmation.current = done;
    mutation.run(path, {
      revision: current!.revision,
      action,
      ...(action === "save" ? { text: draft } : {}),
    });
  }

  async function upload(file: File) {
    setStatus("");
    setUploadError(null);
    if (!imageTypes.includes(file.type)) {
      setUploadError(
        "Choose a PNG, JPEG or WebP image of the payment QR code.",
      );
      return;
    }
    if (file.size > 1024 * 1024) {
      setUploadError("The image is larger than 1 MB. Choose a smaller image.");
      return;
    }
    setUploading(true);
    try {
      const response = await fetch(
        `${path}/qr?operationKey=${crypto.randomUUID()}&revision=${current!.revision}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session?.access_token}`,
            "Content-Type": file.type,
          },
          body: file,
          signal: AbortSignal.timeout(20000),
        },
      );
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error?.message ?? "The image wasn’t saved.");
      setSaved(result);
      setStatus("QR image saved.");
    } catch (error) {
      if (error instanceof Error && error.name === "Error")
        setUploadError(error.message);
      else {
        // An interrupted upload may still have saved: show what the server has.
        setUploadError(
          "The upload wasn’t confirmed. Showing the latest saved instructions.",
        );
        setSaved(null);
        loaded.retry();
      }
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  return (
    <section
      className="rp-card payment-editor"
      aria-labelledby="payment-editor"
    >
      <h2 id="payment-editor">Payment instructions</h2>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          change("save", "Instructions saved.");
        }}
      >
        <fieldset disabled={busy}>
          <Field
            id="payment-text"
            label="How to pay"
            help="Only people booked in this session see this. Payment happens outside RallyPoint."
          >
            <textarea
              id="payment-text"
              rows={3}
              maxLength={1000}
              required
              placeholder="PayNow 9123 4567, with your name as the reference"
              value={draft}
              onChange={(e) => setText(e.target.value)}
              aria-describedby="payment-text-help"
            />
          </Field>
          <div className="fee-actions">
            <button
              className={buttonClass({ variant: "primary" })}
              disabled={!draft.trim()}
            >
              {mutation.busy ? "Saving…" : "Save instructions"}
            </button>
            {instructions ? (
              <button
                type="button"
                className={buttonClass()}
                onClick={() => change("remove", "Instructions removed.")}
              >
                Remove instructions
              </button>
            ) : null}
          </div>
        </fieldset>
      </form>
      {instructions ? (
        <div className="payment-qr-field">
          <Field
            id="payment-qr"
            label={
              instructions.hasImage
                ? "Replace QR image"
                : "Add a QR image (optional)"
            }
            help="PNG, JPEG or WebP, up to 1 MB. The written instructions still show if it can’t load."
          >
            <input
              ref={fileInput}
              id="payment-qr"
              type="file"
              accept={imageTypes.join(",")}
              disabled={busy}
              aria-describedby="payment-qr-help"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void upload(file);
              }}
            />
          </Field>
          {uploading ? <Pending>Saving QR image…</Pending> : null}
          {instructions.hasImage ? (
            <>
              <QrImage slug={slug} revision={instructions.revision} />
              <button
                type="button"
                className={buttonClass()}
                disabled={busy}
                onClick={() => change("remove_image", "QR image removed.")}
              >
                Remove QR image
              </button>
            </>
          ) : null}
        </div>
      ) : null}
      {instructions ? (
        <p className="rp-help">Last changed by {instructions.updatedBy}.</p>
      ) : null}
      {mutation.error ? <Notice>{mutation.error}</Notice> : null}
      {uploadError ? <Notice>{uploadError}</Notice> : null}
      {mutation.recovery}
      {status ? (
        <p className="save-status" role="status">
          {status}
        </p>
      ) : null}
    </section>
  );
}
