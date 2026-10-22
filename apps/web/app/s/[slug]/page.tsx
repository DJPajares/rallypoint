import { Suspense } from "react";
import { Pending } from "@rallypoint/ui";
import { SharedSessionPage } from "@/session-pages";
export default function Page() {
  return (
    <Suspense fallback={<Pending />}>
      <SharedSessionPage />
    </Suspense>
  );
}
