"use client";
import { Toast } from "@base-ui/react/toast";
import type { ToastTone } from "./components/toast";

/** Shows a short message such as "Profile saved." inside ToastProvider. */
export function useToast() {
  const manager = Toast.useToastManager();
  return (title: string, tone: ToastTone = "success") =>
    manager.add({ title, type: tone });
}
