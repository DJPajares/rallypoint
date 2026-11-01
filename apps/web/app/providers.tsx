"use client";
import type { ReactNode } from "react";
import { ToastProvider } from "@rallypoint/ui";
import { AuthProvider } from "@/auth";
import { Shell } from "@/shell";
export function Providers({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <ToastProvider>
        <Shell>{children}</Shell>
      </ToastProvider>
    </AuthProvider>
  );
}
