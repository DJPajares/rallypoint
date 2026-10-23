"use client";
import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
/**
 * A native modal dialog: the browser traps focus, closes it on Escape and
 * returns focus to whatever opened it. Anchored to the bottom edge on phones.
 * Children mount only while open, so a sheet's data loads when it is wanted.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    else if (!open && element.open) element.close();
  }, [open]);
  return (
    <dialog
      ref={dialog}
      className="rp-sheet"
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(event) => {
        // A click on the dialog box itself (not its content) is the backdrop.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {open ? (
        <div className="rp-sheet__body">
          <div className="rp-sheet__head">
            <h2 id={titleId}>{title}</h2>
            <button
              type="button"
              className="rp-icon-button rp-icon-button--flat"
              aria-label="Close"
              onClick={onClose}
            >
              <XIcon size={20} aria-hidden="true" />
            </button>
          </div>
          {children}
        </div>
      ) : null}
    </dialog>
  );
}
