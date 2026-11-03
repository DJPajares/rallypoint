import { Suspense } from "react";
import { TabSkeleton } from "@/skeletons";
import { RequireAuth } from "@/screens";
import { CourtsPage } from "@/courts-page";
export default function Page() {
  return (
    <Suspense fallback={<TabSkeleton label="Getting courts ready…" rows={3} />}>
      <RequireAuth
        fallback={<TabSkeleton label="Getting courts ready…" rows={3} />}
      >
        <CourtsPage />
      </RequireAuth>
    </Suspense>
  );
}
