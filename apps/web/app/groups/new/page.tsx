import { Suspense } from "react";
import { FormSkeleton } from "@/skeletons";
import { CreateGroup } from "@/session-pages";
import { RequireAuth } from "@/screens";
export default function Page() {
  return (
    <Suspense
      fallback={<FormSkeleton label="Getting things ready…" fields={2} />}
    >
      <RequireAuth
        fallback={<FormSkeleton label="Getting things ready…" fields={2} />}
      >
        <CreateGroup />
      </RequireAuth>
    </Suspense>
  );
}
