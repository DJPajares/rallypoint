import { Suspense } from "react";
import { Pending } from "@/ui";
import { SignIn } from "@/screens";
export default function Page() {
  return (
    <Suspense fallback={<Pending />}>
      <SignIn />
    </Suspense>
  );
}
