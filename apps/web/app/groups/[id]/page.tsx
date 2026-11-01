import { Suspense } from "react";
import { GroupSkeleton } from "@/skeletons";
import { RequireAuth } from "@/screens";
import { GroupPage } from "@/group-page";
export default function Page() {
  return (
    <Suspense fallback={<GroupSkeleton />}>
      <RequireAuth fallback={<GroupSkeleton />}>
        <GroupPage />
      </RequireAuth>
    </Suspense>
  );
}
