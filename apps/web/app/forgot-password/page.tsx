import { Suspense } from "react";
import { FormSkeleton } from "@/skeletons";
import { ForgotPassword } from "@/auth-pages";
export default function Page() {
  return (
    <Suspense
      fallback={<FormSkeleton label="Getting things ready…" fields={1} />}
    >
      <ForgotPassword />
    </Suspense>
  );
}
