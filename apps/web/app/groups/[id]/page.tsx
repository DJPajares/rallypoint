import { Suspense } from "react";
import { Pending } from "@rallypoint/ui";
import { RequireAuth } from "@/screens";
import { GroupPage } from "@/group-page";
export default function Page() {
  return (
    <Suspense fallback={<Pending />}>
      <RequireAuth>
        <GroupPage />
      </RequireAuth>
    </Suspense>
  );
}
