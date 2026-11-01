import { Suspense } from "react";
import { TabSkeleton } from "@/skeletons";
import { RequireAuth } from "@/screens";
import { SearchPage } from "@/search-page";
export default function Page() {
  return (
    <Suspense fallback={<TabSkeleton label="Getting search ready…" rows={3} />}>
      <RequireAuth
        fallback={<TabSkeleton label="Getting search ready…" rows={3} />}
      >
        <SearchPage />
      </RequireAuth>
    </Suspense>
  );
}
