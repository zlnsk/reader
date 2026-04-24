import { NextRequest } from "next/server";
import { requireOpdsAuth, publicBase } from "@/lib/opds-auth";
import { renderAtom, NAV_TYPE, ACQ_TYPE, Feed } from "@/lib/opds-feed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Root OPDS navigation feed. Discoverable by clients that follow the top-
// level catalog URL (e.g. KOReader settings -> OPDS catalog -> URL).
export async function GET(req: NextRequest) {
  const auth = await requireOpdsAuth(req);
  if (auth instanceof Response) return auth;
  const base = publicBase(req);
  const now = new Date().toISOString();
  const feed: Feed = {
    id: `${base}/opds`,
    title: "Reader",
    subtitle: `Library of ${auth.email}`,
    updated: now,
    author: { name: "Reader", uri: base },
    links: [
      { rel: "self", href: `${base}/opds`, type: NAV_TYPE },
      { rel: "start", href: `${base}/opds`, type: NAV_TYPE },
      { rel: "search", href: `${base}/opds/opensearch.xml`, type: "application/opensearchdescription+xml" },
    ],
    entries: [
      {
        id: `${base}/opds/new`,
        title: "Recent",
        updated: now,
        content: { type: "text", value: "Most recently added books." },
        links: [{ rel: "http://opds-spec.org/sort/new", href: `${base}/opds/new`, type: ACQ_TYPE, title: "Recent" }],
      },
      {
        id: `${base}/opds/all`,
        title: "All books",
        updated: now,
        content: { type: "text", value: "All books in the library." },
        links: [{ rel: "subsection", href: `${base}/opds/all`, type: ACQ_TYPE, title: "All books" }],
      },
      {
        id: `${base}/opds/archived`,
        title: "Archived",
        updated: now,
        content: { type: "text", value: "Archived books." },
        links: [{ rel: "subsection", href: `${base}/opds/archived`, type: ACQ_TYPE, title: "Archived" }],
      },
    ],
  };
  return new Response(renderAtom(feed), {
    status: 200,
    headers: { "Content-Type": NAV_TYPE, "Cache-Control": "private, no-store" },
  });
}
