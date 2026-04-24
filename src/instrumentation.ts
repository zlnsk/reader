// Next.js 15 instrumentation hook — runs once on server startup.
// Delegates to a Node-only module so the Edge bundle doesn't trace pg/epub2.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}
