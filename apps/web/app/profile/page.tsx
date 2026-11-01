import { Suspense } from "react";
import { ProfileSkeleton } from "@/skeletons";
import { RequireAuth } from "@/screens";
import { ProfilePage } from "@/badges";
export default function Page() {
  return (
    <Suspense fallback={<ProfileSkeleton label="Opening your profile…" />}>
      <RequireAuth fallback={<ProfileSkeleton label="Opening your profile…" />}>
        <ProfilePage />
      </RequireAuth>
    </Suspense>
  );
}
