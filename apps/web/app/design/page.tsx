import { notFound } from "next/navigation";
import { DesignCatalog } from "@/design-catalog";
// The catalog is a development tool; production builds answer 404.
export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return <DesignCatalog />;
}
