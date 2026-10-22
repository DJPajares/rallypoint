import { Suspense } from "react";
import { Pending } from "@/ui";
import { CreateGroup } from "@/session-pages";
import { RequireAuth } from "@/screens";
export default function Page() {
  return (
    <Suspense fallback={<Pending />}>
      <RequireAuth>
        <CreateGroup />
      </RequireAuth>
    </Suspense>
  );
}
