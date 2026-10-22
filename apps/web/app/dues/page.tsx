import { Suspense } from "react";
import { Pending } from "@rallypoint/ui";
import { DuesPage, RequireAuth } from "@/screens";
export default function Page() {
  return (
    <Suspense fallback={<Pending />}>
      <RequireAuth>
        <DuesPage />
      </RequireAuth>
    </Suspense>
  );
}
