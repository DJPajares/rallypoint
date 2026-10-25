import { Suspense } from "react";
import { Pending } from "@rallypoint/ui";
import { SignIn } from "@/auth-pages";
export default function Page() {
  return (
    <Suspense fallback={<Pending />}>
      <SignIn />
    </Suspense>
  );
}
