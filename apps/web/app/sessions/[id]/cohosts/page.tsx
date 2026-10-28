import { Suspense } from "react";
import { Pending } from "@rallypoint/ui";
import { CohostManagement } from "@/cohost-management";
import { RequireAuth } from "@/screens";

export default function Page() {
  return (
    <Suspense fallback={<Pending />}>
      <RequireAuth>
        <CohostManagement />
      </RequireAuth>
    </Suspense>
  );
}
