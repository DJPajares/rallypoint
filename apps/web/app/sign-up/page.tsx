import { Suspense } from "react";
import { Pending } from "@rallypoint/ui";
import { SignUp } from "@/auth-pages";
export default function Page() {
  return (
    <Suspense fallback={<Pending />}>
      <SignUp />
    </Suspense>
  );
}
