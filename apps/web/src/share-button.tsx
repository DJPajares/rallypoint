"use client";
import type { ReactNode } from "react";
import { buttonClass, cx } from "@rallypoint/ui";
import { useState } from "react";
import { ShareNetworkIcon } from "@phosphor-icons/react/dist/csr/ShareNetwork";
/** Native share sheet where the device has one; otherwise copy the link. */
export function ShareButton({
  title,
  primary = false,
  url,
  label = "Share",
  className,
}: {
  title: string;
  /** The page's one orange action, for organizers whose main job is sharing. */
  primary?: boolean;
  /** What to share; the current page when left out. */
  url?: string;
  label?: ReactNode;
  /** Extra classes for the button, such as its size in a row of actions. */
  className?: string;
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
        className={cx(
          buttonClass({ variant: primary ? "primary" : "secondary" }),
          className,
        )}
        onClick={() => void share()}
      >
        <ShareNetworkIcon size={18} aria-hidden="true" />
        {label}
      </button>
      <span role="status" className="sr-only">
        {status}
      </span>
    </>
  );
}
