import { Suspense } from "react";
import { TabSkeleton } from "@/skeletons";
import { SessionsPage, RequireAuth } from "@/screens";
export default function Page() {
  return (
    <Suspense fallback={<TabSkeleton label="Finding your sessions…" />}>
      <RequireAuth fallback={<TabSkeleton label="Finding your sessions…" />}>
        <SessionsPage />
      </RequireAuth>
    </Suspense>
  );
}
