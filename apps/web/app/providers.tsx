"use client";
import type { ReactNode } from "react";
import { ToastProvider } from "@rallypoint/ui";
import { AuthProvider } from "@/auth";
import { Shell } from "@/shell";
import { ThemeProvider } from "@/theme";
export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <AuthProvider>
        <ToastProvider>
          <Shell>{children}</Shell>
        </ToastProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
