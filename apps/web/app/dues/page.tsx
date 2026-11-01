import { Suspense } from "react";
import { TabSkeleton } from "@/skeletons";
import { DuesPage, RequireAuth } from "@/screens";
export default function Page() {
  return (
    <Suspense fallback={<TabSkeleton label="Loading your dues…" rows={3} />}>
      <RequireAuth
        fallback={<TabSkeleton label="Loading your dues…" rows={3} />}
      >
        <DuesPage />
      </RequireAuth>
    </Suspense>
  );
}
