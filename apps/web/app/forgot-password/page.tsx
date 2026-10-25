import { Suspense } from "react";
import { Pending } from "@rallypoint/ui";
import { ForgotPassword } from "@/auth-pages";
export default function Page() {
  return (
    <Suspense fallback={<Pending />}>
      <ForgotPassword />
    </Suspense>
  );
}
