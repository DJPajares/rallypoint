import { Suspense } from "react";
import { Pending } from "@rallypoint/ui";
import { HomeDashboard, RequireAuth } from "@/screens";
export default function Page() {
  return (
    <Suspense fallback={<Pending />}>
      <RequireAuth>
        <HomeDashboard />
      </RequireAuth>
    </Suspense>
  );
}
