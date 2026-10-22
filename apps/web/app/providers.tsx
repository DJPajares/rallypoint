"use client";
import type { ReactNode } from "react";
import { AuthProvider } from "@/auth";
import { Shell } from "@/shell";
export function Providers({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <Shell>{children}</Shell>
    </AuthProvider>
  );
}
