import { Suspense } from "react";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Bricolage_Grotesque, Inter } from "next/font/google";
import { themeColor } from "@rallypoint/ui";
import { Providers } from "./providers";
import "@rallypoint/ui/styles.css";
import "@/styles/frame.css";
import "@/styles/pages.css";
import "@/styles/badges.css";
import "@/styles/game-day.css";
const display = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-display-family",
  display: "swap",
});
const body = Inter({
  subsets: ["latin"],
  variable: "--font-ui-family",
  display: "swap",
});
// Runs before paint so a saved light/dark choice never flashes the other theme.
// "system" is the absence of the attribute; the CSS media query takes over.
const themeScript = `try{var t=localStorage.getItem("rallypoint.theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;
export const metadata: Metadata = {
  title: "RallyPoint",
  description:
    "Fill the spots, not the chat. Bring your people together with RallyPoint.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icons/icon-192.png", apple: "/icons/icon-192.png" },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "RallyPoint",
  },
};
export const viewport: Viewport = {
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: themeColor.light },
    { media: "(prefers-color-scheme: dark)", color: themeColor.dark },
  ],
};
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${body.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <Suspense>
          <Providers>{children}</Providers>
        </Suspense>
      </body>
    </html>
  );
}
