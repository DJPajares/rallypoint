import { Suspense } from "react";
import { FormSkeleton } from "@/skeletons";
import { SignIn } from "@/auth-pages";
export default function Page() {
  return (
    <Suspense
      fallback={<FormSkeleton label="Getting things ready…" fields={2} />}
    >
      <SignIn />
    </Suspense>
  );
}
