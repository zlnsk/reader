import { requirePageEmail } from "@/lib/user";
import AppPasswordsClient from "./AppPasswordsClient";

export const dynamic = "force-dynamic";

export default async function AppPasswordsPage() {
  const email = await requirePageEmail();
  return <AppPasswordsClient email={email} />;
}
