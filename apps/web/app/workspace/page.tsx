import { Suspense } from "react";
import { TabSkeleton } from "@/skeletons";
import { Workspace, RequireAuth } from "@/screens";
export default function Page() {
  return (
    <Suspense fallback={<TabSkeleton label="Finding your groups…" />}>
      <RequireAuth fallback={<TabSkeleton label="Finding your groups…" />}>
        <Workspace />
      </RequireAuth>
    </Suspense>
  );
}
