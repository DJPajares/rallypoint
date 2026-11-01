import { Suspense } from "react";
import { SessionSkeleton } from "@/skeletons";
import { SharedSessionPage } from "@/session-pages";
export default function Page() {
  return (
    <Suspense fallback={<SessionSkeleton />}>
      <SharedSessionPage />
    </Suspense>
  );
}
