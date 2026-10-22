import { Suspense } from "react";
import { Pending } from "@/ui";
import { NewSession } from "@/session-pages";
import { RequireAuth } from "@/screens";
export default function Page() {
  return (
    <Suspense fallback={<Pending />}>
      <RequireAuth>
        <NewSession />
      </RequireAuth>
    </Suspense>
  );
}
