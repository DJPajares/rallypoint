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
        <Toast.Viewport className="fixed top-[calc(12px+var(--safe-top))] left-1/2 z-(--layer-skip) w-[min(calc(100vw-32px),24rem)] -translate-x-1/2">
          <ToastList />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  );
}

// Stacked with the newest in front: each one behind peeks 8px lower and
// shrinks a little; hovered or focused, the stack opens into a list. Toasts
// slide in from the top and leave up or to the right, or just fade with
// reduced motion.
const toastClass =
  "absolute inset-x-0 top-0 z-[calc(100-var(--toast-index))] origin-top rounded-lg border border-border bg-surface text-text shadow-lg select-none [--peek:8px] [transition:transform_200ms_var(--ease-standard),opacity_200ms_var(--ease-standard)] transform-[translateX(var(--toast-swipe-movement-x))_translateY(calc(var(--toast-swipe-movement-y)+(var(--toast-index)*var(--peek))))_scale(calc(max(0,1-(var(--toast-index)*0.06))))] data-expanded:transform-[translateX(var(--toast-swipe-movement-x))_translateY(calc(var(--toast-offset-y)+(var(--toast-index)*var(--peek))+var(--toast-swipe-movement-y)))] data-limited:opacity-0 data-swiping:transition-none data-starting-style:opacity-0 data-starting-style:transform-[translateY(-150%)] data-ending-style:opacity-0 data-ending-style:transform-[translateY(-150%)] data-ending-style:data-[swipe-direction=right]:transform-[translateX(calc(var(--toast-swipe-movement-x)+150%))] motion-reduce:[transition:opacity_150ms_linear] motion-reduce:data-starting-style:transform-none motion-reduce:data-ending-style:transform-none";

function ToastList() {
  const { toasts } = Toast.useToastManager();
  return toasts.map((toast) => {
    const tone: ToastTone = toast.type === "danger" ? "danger" : "success";
    return (
      <Toast.Root
        key={toast.id}
        toast={toast}
        swipeDirection={["up", "right"]}
        className={toastClass}
      >
        <Toast.Content className="flex min-h-control items-center gap-2 py-2 pr-2 pl-4 transition-opacity data-behind:not-in-data-expanded:opacity-0">
          <span
            className="inline-flex flex-none in-data-[type=danger]:text-danger in-data-[type=success]:text-success"
            aria-hidden="true"
          >
            {icons[tone]}
          </span>
          <Toast.Title className="m-0 min-w-0 flex-1 text-base font-semibold" />
          <Toast.Close
            className="inline-flex size-touch flex-none items-center justify-center rounded-full border-0 bg-transparent text-text-muted hover:bg-surface-sunken focus-visible:-outline-offset-3"
            aria-label="Dismiss"
          >
            <XIcon size={16} aria-hidden="true" />
          </Toast.Close>
        </Toast.Content>
      </Toast.Root>
    );
  });
}
