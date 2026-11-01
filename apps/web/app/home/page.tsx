import { Suspense } from "react";
import { TabSkeleton } from "@/skeletons";
import { HomeDashboard, RequireAuth } from "@/screens";
export default function Page() {
  return (
    <Suspense fallback={<TabSkeleton label="Finding what's next…" upNext />}>
      <RequireAuth
        fallback={<TabSkeleton label="Finding what's next…" upNext />}
      >
        <HomeDashboard />
      </RequireAuth>
    </Suspense>
  );
}
