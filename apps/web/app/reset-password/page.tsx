import { Suspense } from "react";
import { Pending } from "@rallypoint/ui";
import { ResetPassword } from "@/auth-pages";
export default function Page() {
  return (
    <Suspense fallback={<Pending />}>
      <ResetPassword />
    </Suspense>
  );
}
