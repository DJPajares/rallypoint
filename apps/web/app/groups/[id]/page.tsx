import { Suspense } from "react";
import { Pending } from "@rallypoint/ui";
import { GroupSetup, RequireAuth } from "@/screens";
export default function Page() {
  return (
    <Suspense fallback={<Pending />}>
      <RequireAuth>
        <GroupSetup />
      </RequireAuth>
    </Suspense>
  );
}
