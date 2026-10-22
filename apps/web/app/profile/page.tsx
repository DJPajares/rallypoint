import { Suspense } from "react";
import { Pending } from "@rallypoint/ui";
import { RequireAuth } from "@/screens";
import { ProfilePage } from "@/badges";
export default function Page() {
  return (
    <Suspense fallback={<Pending />}>
      <RequireAuth>
        <ProfilePage />
      </RequireAuth>
    </Suspense>
  );
}
