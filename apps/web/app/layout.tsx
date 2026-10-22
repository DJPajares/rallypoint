import { Suspense } from "react";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Providers } from "./providers";
import "@/index.css";
import "@/App.css";
export const metadata: Metadata = {
  title: "RallyPoint",
  description:
    "Fill the spots, not the chat. Bring your people together with RallyPoint.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icons/icon-192.png", apple: "/icons/icon-192.png" },
};
export const viewport: Viewport = { themeColor: "#234dc4" };
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Suspense>
          <Providers>{children}</Providers>
        </Suspense>
      </body>
    </html>
  );
}
