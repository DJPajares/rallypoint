import { Suspense } from "react";
import { FormSkeleton } from "@/skeletons";
import { SignUp } from "@/auth-pages";
export default function Page() {
  return (
    <Suspense
      fallback={<FormSkeleton label="Getting things ready…" fields={3} />}
    >
      <SignUp />
    </Suspense>
  );
}
