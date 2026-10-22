import { Suspense } from "react";
import { Pending } from "@rallypoint/ui";
import { SessionsPage, RequireAuth } from "@/screens";
export default function Page() {
  return (
    <Suspense fallback={<Pending />}>
      <RequireAuth>
        <SessionsPage />
      </RequireAuth>
    </Suspense>
  );
}
