import { headers } from "next/headers";
import { redirect } from "next/navigation";

export async function currentEmail(): Promise<string> {
  const h = await headers();
  const email = h.get("x-user-email");
  if (!email) throw new Error("No authenticated user");
  return email.toLowerCase();
}

// Page-context variant: redirects to OTP login instead of throwing.
// Safe to call from React Server Components; must NOT be called from
// API route handlers whose catch blocks swallow NEXT_REDIRECT.
export async function requirePageEmail(): Promise<string> {
  const h = await headers();
  const email = h.get("x-user-email");
  if (!email) redirect("/Reader/api/auth/login");
  return email.toLowerCase();
}
