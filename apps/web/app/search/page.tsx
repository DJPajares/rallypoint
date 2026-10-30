import { Suspense } from "react";
import { Pending } from "@rallypoint/ui";
import { RequireAuth } from "@/screens";
import { SearchPage } from "@/search-page";
export default function Page() {
  return (
    <Suspense fallback={<Pending />}>
      <RequireAuth>
        <SearchPage />
      </RequireAuth>
    </Suspense>
  );
}
