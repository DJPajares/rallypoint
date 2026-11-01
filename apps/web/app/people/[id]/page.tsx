import { Suspense } from "react";
import { ProfileSkeleton } from "@/skeletons";
import { PersonProfilePage } from "@/badges";
export default function Page() {
  return (
    <Suspense fallback={<ProfileSkeleton label="Opening the profile…" />}>
      <PersonProfilePage />
    </Suspense>
  );
}
