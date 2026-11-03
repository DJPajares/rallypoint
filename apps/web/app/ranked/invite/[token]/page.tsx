import { Suspense } from "react";
import { TabSkeleton } from "@/skeletons";
import { RequireAuth } from "@/screens";
import { RankedInvitePage } from "@/ranked-page";
export default function Page() {
  return (
    <Suspense fallback={<TabSkeleton label="Opening the invite…" rows={1} />}>
      <RequireAuth
        fallback={<TabSkeleton label="Opening the invite…" rows={1} />}
      >
        <RankedInvitePage />
      </RequireAuth>
    </Suspense>
  );
}
