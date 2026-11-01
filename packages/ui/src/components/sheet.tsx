"use client";
import { useEffect, useId, useRef } from "react";
import type { PointerEvent, ReactNode } from "react";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { useIsPhone } from "../media";

/** How far down, or how fast, a swipe must go to close the sheet. */
const closeFraction = 0.25;
const closeDistance = 120;
const flickSpeed = 0.5; // px per ms

const reducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * A native modal dialog: the browser traps focus, closes it on Escape and
 * returns focus to whatever opened it. Anchored to the bottom edge on phones,
 * where its handle and title bar can be swiped down to close it. The page
 * behind doesn't scroll while it's open (see .rp-sheet in components.css).
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
  const closeButton = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const phone = useIsPhone();
  const drag = useRef<{
    id: number;
    startY: number;
    lastY: number;
    lastTime: number;
    speed: number;
  } | null>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      // A sheet swiped away last time starts from its resting place.
      element.style.transform = "";
      element.style.transition = "";
      element.showModal();
      // Start on Close, even when the title holds a link, so a stray Enter
      // dismisses the sheet instead of leaving the page.
      closeButton.current?.focus();
    } else if (!open && element.open) element.close();
  }, [open]);

  function move(to: string, animate: boolean, done?: () => void) {
    const element = dialog.current;
    if (!element) return;
    const smooth = animate && !reducedMotion();
    element.style.transition = smooth
      ? "transform var(--duration-base) var(--ease-standard)"
      : "none";
    element.style.transform = to;
    if (!done) return;
    if (!smooth) return done();
    // Finish on the transition's end, or shortly after if it never comes.
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      done();
    };
    element.addEventListener("transitionend", finish, { once: true });
    setTimeout(finish, 400);
  }

  // Swipe down on the handle and title bar (phones only). The sheet follows
  // the finger; past a quarter of its height, or on a quick flick, it closes,
  // otherwise it springs back. Buttons and links in the bar still just work.
  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!phone || event.button !== 0) return;
    if ((event.target as HTMLElement).closest("button, a, input")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      id: event.pointerId,
      startY: event.clientY,
      lastY: event.clientY,
      lastTime: event.timeStamp,
      speed: 0,
    };
  }
  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const state = drag.current;
    if (!state || state.id !== event.pointerId) return;
    const elapsed = event.timeStamp - state.lastTime;
    if (elapsed > 0) state.speed = (event.clientY - state.lastY) / elapsed;
    state.lastY = event.clientY;
    state.lastTime = event.timeStamp;
    // Only downward; pulling up stays put.
    const down = Math.max(0, event.clientY - state.startY);
    move(`translateY(${down}px)`, false);
  }
  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    const state = drag.current;
    if (!state || state.id !== event.pointerId) return;
    drag.current = null;
    const element = dialog.current;
    if (!element) return;
    const down = Math.max(0, event.clientY - state.startY);
    const far = Math.min(closeDistance, element.offsetHeight * closeFraction);
    if (down > far || (down > 0 && state.speed > flickSpeed))
      move("translateY(100%)", true, onClose);
    else move("", true);
  }
  function onPointerCancel(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.id !== event.pointerId) return;
    drag.current = null;
    move("", true);
  }

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
          <div
            className="rp-sheet__head"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
          >
            <h2 id={titleId}>{title}</h2>
            <button
              ref={closeButton}
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
