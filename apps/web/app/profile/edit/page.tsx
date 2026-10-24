import { Suspense } from "react";
import { Pending } from "@rallypoint/ui";
import { RequireAuth } from "@/screens";
import { EditProfile } from "@/profile-edit";
export default function Page() {
  return (
    <Suspense fallback={<Pending />}>
      <RequireAuth>
        <EditProfile />
      </RequireAuth>
    </Suspense>
  );
}
