import { Suspense } from "react";
import { Pending } from "@/ui";
import { Workspace, RequireAuth } from "@/screens";
export default function Page() {
  return (
    <Suspense fallback={<Pending />}>
      <RequireAuth>
        <Workspace />
      </RequireAuth>
    </Suspense>
  );
}
