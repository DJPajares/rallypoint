"use client";
import { buttonClass } from "@rallypoint/ui";
import { useState } from "react";
import { ShareNetworkIcon } from "@phosphor-icons/react/dist/csr/ShareNetwork";
/** Native share sheet where the device has one; otherwise copy the link. */
export function ShareButton({ title }: { title: string }) {
  const [status, setStatus] = useState("");
  async function share() {
    const url = window.location.href;
    setStatus("");
    if (navigator.share) {
      try {
        await navigator.share({ title, url });
        return;
      } catch (error) {
        // Dismissing the share sheet is a choice, not a failure.
        if (error instanceof DOMException && error.name === "AbortError")
          return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setStatus("Link copied.");
    } catch {
      setStatus("Copy wasn’t available. Copy the address from your browser.");
    }
  }
  return (
    <>
      <button
        type="button"
        className={buttonClass()}
        onClick={() => void share()}
      >
        <ShareNetworkIcon size={18} aria-hidden="true" />
        Share
      </button>
      <span role="status" className="rp-sr-only">
        {status}
      </span>
    </>
  );
}
