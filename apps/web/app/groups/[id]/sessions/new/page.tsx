import { redirect } from "next/navigation";

// Sessions stand alone (P-35): creating one no longer starts from a group.
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from } = await searchParams;
  redirect(
    from ? `/sessions/new?from=${encodeURIComponent(from)}` : "/sessions/new",
  );
}
