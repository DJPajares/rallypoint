import { Suspense } from "react";
import { FormSkeleton } from "@/skeletons";
import { NewSession } from "@/session-pages";
import { RequireAuth } from "@/screens";
export default function Page() {
  return (
    <Suspense
      fallback={<FormSkeleton label="Getting things ready…" fields={5} />}
    >
      <RequireAuth
        fallback={<FormSkeleton label="Getting things ready…" fields={5} />}
      >
        <NewSession />
      </RequireAuth>
    </Suspense>
  );
}
