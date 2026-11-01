import { Suspense } from "react";
import { FormSkeleton } from "@/skeletons";
import { EditGroup, RequireAuth } from "@/screens";
export default function Page() {
  return (
    <Suspense
      fallback={<FormSkeleton label="Opening your group…" fields={2} />}
    >
      <RequireAuth
        fallback={<FormSkeleton label="Opening your group…" fields={2} />}
      >
        <EditGroup />
      </RequireAuth>
    </Suspense>
  );
}
