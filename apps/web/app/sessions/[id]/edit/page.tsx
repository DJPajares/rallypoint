import { Suspense } from "react";
import { Pending } from "@/ui";
import { SessionEditor } from "@/session-pages";
import { RequireAuth } from "@/screens";
export default function Page() {
  return (
    <Suspense fallback={<Pending />}>
      <RequireAuth>
        <SessionEditor />
      </RequireAuth>
    </Suspense>
  );
}
