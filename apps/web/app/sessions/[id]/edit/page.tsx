import { Suspense } from "react";
import { FormSkeleton } from "@/skeletons";
import { SessionEditor } from "@/session-pages";
import { RequireAuth } from "@/screens";
export default function Page() {
  return (
    <Suspense
      fallback={<FormSkeleton label="Opening the session…" fields={5} />}
    >
      <RequireAuth
        fallback={<FormSkeleton label="Opening the session…" fields={5} />}
      >
        <SessionEditor />
      </RequireAuth>
    </Suspense>
  );
}
