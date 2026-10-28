import { redirect } from "next/navigation";

// Co-hosts belong to each session now (P-35); a group has members instead.
export default function Page() {
  redirect("/workspace");
}
