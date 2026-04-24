import OpdsClient from "./OpdsClient";
import { requirePageEmail } from "@/lib/user";

export const dynamic = "force-dynamic";

export default async function OpdsClientPage() {
  const email = await requirePageEmail();
  return <OpdsClient email={email} />;
}
