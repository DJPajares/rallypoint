import { Suspense } from "react";
import { ListSkeleton } from "@/skeletons";
import { CohostManagement } from "@/cohost-management";
import { RequireAuth } from "@/screens";

export default function Page() {
  return (
    <Suspense fallback={<ListSkeleton label="Loading co-hosts…" />}>
      <RequireAuth fallback={<ListSkeleton label="Loading co-hosts…" />}>
        <CohostManagement />
      </RequireAuth>
    </Suspense>
  );
}
