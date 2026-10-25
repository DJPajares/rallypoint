"use client";
import { buttonClass } from "@rallypoint/ui";
import { useState } from "react";
import { ShareNetworkIcon } from "@phosphor-icons/react/dist/csr/ShareNetwork";
/** Native share sheet where the device has one; otherwise copy the link. */
export function ShareButton({
  title,
  primary = false,
  url,
  label = "Share",
}: {
  title: string;
  /** The page's one orange action, for organizers whose main job is sharing. */
  primary?: boolean;
  /** What to share; the current page when left out. */
  url?: string;
  label?: string;
}) {
  const [status, setStatus] = useState("");
  async function share() {
    const link = url ?? window.location.href;
    setStatus("");
    if (navigator.share) {
      try {
        await navigator.share({ title, url: link });
        return;
      } catch (error) {
        // Dismissing the share sheet is a choice, not a failure.
        if (error instanceof DOMException && error.name === "AbortError")
          return;
      }
    }
    try {
      await navigator.clipboard.writeText(link);
      setStatus("Link copied.");
    } catch {
      setStatus("Copy wasn’t available. Copy the address from your browser.");
    }
  }
  return (
    <>
      <button
        type="button"
        className={buttonClass({ variant: primary ? "primary" : "secondary" })}
        onClick={() => void share()}
      >
        <ShareNetworkIcon size={18} aria-hidden="true" />
        {label}
      </button>
      <span role="status" className="rp-sr-only">
        {status}
      </span>
    </>
  );
}
