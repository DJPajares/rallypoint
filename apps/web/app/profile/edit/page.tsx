import { Suspense } from "react";
import { FormSkeleton } from "@/skeletons";
import { RequireAuth } from "@/screens";
import { EditProfile } from "@/profile-edit";
export default function Page() {
  return (
    <Suspense
      fallback={<FormSkeleton label="Opening your profile…" fields={3} />}
    >
      <RequireAuth
        fallback={<FormSkeleton label="Opening your profile…" fields={3} />}
      >
        <EditProfile />
      </RequireAuth>
    </Suspense>
  );
}
