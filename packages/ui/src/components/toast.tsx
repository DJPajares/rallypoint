"use client";
import type { ReactNode } from "react";
import { Toast } from "@base-ui/react/toast";
import { CheckCircleIcon } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { WarningCircleIcon } from "@phosphor-icons/react/dist/csr/WarningCircle";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";

/** What a toast reports: a done action, or one that needs another go. */
export type ToastTone = "success" | "danger";

const icons: Record<ToastTone, ReactNode> = {
  success: <CheckCircleIcon size={20} weight="fill" />,
  danger: <WarningCircleIcon size={20} weight="fill" />,
};

/**
 * Brief confirmations that pop in at the top and leave on their own (Base UI
 * Toast). Screen readers hear each one through the viewport's live region.
 * Put this once around the app; `useToast` adds a toast from anywhere inside.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  return (
    <Toast.Provider timeout={4000} limit={3}>
      {children}
      <Toast.Portal>
        <Toast.Viewport className="rp-toasts">
          <ToastList />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  );
}

function ToastList() {
  const { toasts } = Toast.useToastManager();
  return toasts.map((toast) => {
    const tone: ToastTone = toast.type === "danger" ? "danger" : "success";
    return (
      <Toast.Root
        key={toast.id}
        toast={toast}
        swipeDirection={["up", "right"]}
        className={`rp-toast rp-tone-${tone}`}
      >
        <Toast.Content className="rp-toast__content">
          <span className="rp-toast__icon" aria-hidden="true">
            {icons[tone]}
          </span>
          <Toast.Title className="rp-toast__title" />
          <Toast.Close className="rp-toast__close" aria-label="Dismiss">
            <XIcon size={16} aria-hidden="true" />
          </Toast.Close>
        </Toast.Content>
      </Toast.Root>
    );
  });
}
