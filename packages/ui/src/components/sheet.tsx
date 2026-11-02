"use client";
import { useLayoutEffect, useRef } from "react";
import type { ReactNode } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { Drawer as DrawerPrimitive } from "@base-ui/react/drawer";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { iconButtonClass } from "../classes";
import { useIsPhone } from "../media";
import { Dialog, DialogContent } from "./ui/dialog";
import { Drawer, DrawerContent } from "./ui/drawer";

const titleClass = "m-0 text-xl";
const headClass =
  "sticky top-0 z-1 -mx-5 mb-2 flex items-center justify-between gap-3 bg-card px-5 pt-3 pb-2";

/**
 * A sheet for one focused job (D-15). On phones it's shadcn's Drawer: it
 * slides up from the bottom and swipes down to close. Elsewhere it's shadcn's
 * Dialog, a centred card. Either way the page behind is locked, Escape and
 * the backdrop close it, focus starts on Close and returns to whatever had it
 * when the sheet opened. Children mount only while open, so a sheet's data
 * loads when it is wanted.
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
  const phone = useIsPhone();
  const closeButton = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  // Remember what had focus before the sheet takes it, to hand it back.
  useLayoutEffect(() => {
    if (open && document.activeElement instanceof HTMLElement)
      opener.current = document.activeElement;
  }, [open]);
  const onOpenChange = (next: boolean) => {
    if (!next) onClose();
  };
  const closeProps = {
    ref: closeButton,
    "aria-label": "Close",
    className: iconButtonClass(true),
    children: <XIcon size={20} aria-hidden="true" />,
  };

  if (phone)
    return (
      <Drawer open={open} onOpenChange={onOpenChange} showSwipeHandle>
        <DrawerContent
          initialFocus={closeButton}
          finalFocus={opener}
          data-slot="sheet"
        >
          {/* The title bar stays outside the scrolling content, so dragging it
              always moves the sheet, never the content (like native sheets). */}
          <div className="flex flex-none items-center justify-between gap-3 px-5 pt-1 pb-2">
            <DrawerPrimitive.Title className={titleClass}>
              {title}
            </DrawerPrimitive.Title>
            <DrawerPrimitive.Close {...closeProps} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-[calc(24px+var(--safe-bottom))]">
            {children}
          </div>
        </DrawerContent>
      </Drawer>
    );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        initialFocus={closeButton}
        finalFocus={opener}
        data-slot="sheet"
        className="block px-5 pt-2 pb-6"
      >
        <div className={headClass}>
          <DialogPrimitive.Title className={titleClass}>
            {title}
          </DialogPrimitive.Title>
          <DialogPrimitive.Close {...closeProps} />
        </div>
        {children}
      </DialogContent>
    </Dialog>
  );
}
