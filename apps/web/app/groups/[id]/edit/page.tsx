import { Suspense } from "react";
import { Pending } from "@rallypoint/ui";
import { EditGroup, RequireAuth } from "@/screens";
export default function Page() {
  return (
    <Suspense fallback={<Pending />}>
      <RequireAuth>
        <EditGroup />
      </RequireAuth>
    </Suspense>
  );
}
