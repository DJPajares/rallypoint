import { Suspense } from "react";
import { TabSkeleton } from "@/skeletons";
import { RequireAuth } from "@/screens";
import { RankedPage } from "@/ranked-page";
export default function Page() {
  return (
    <Suspense fallback={<TabSkeleton label="Getting ranked ready…" rows={3} />}>
      <RequireAuth
        fallback={<TabSkeleton label="Getting ranked ready…" rows={3} />}
      >
        <RankedPage />
      </RequireAuth>
    </Suspense>
  );
}
