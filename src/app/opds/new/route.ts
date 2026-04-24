import { NextRequest } from "next/server";
import { requireOpdsAuth, publicBase } from "@/lib/opds-auth";
import { renderAtom, ACQ_TYPE, NAV_TYPE, Feed } from "@/lib/opds-feed";
import { fetchBooksPage, bookToEntry } from "@/lib/opds-entries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireOpdsAuth(req);
  if (auth instanceof Response) return auth;
  const base = publicBase(req);
  const { rows, total } = await fetchBooksPage(auth.email, { page: 1, per: 50, archived: false });
  const feed: Feed = {
    id: `${base}/opds/new`,
    title: "Reader — Recent",
    updated: new Date().toISOString(),
    totalResults: total,
    itemsPerPage: 50,
    startIndex: 1,
    links: [
      { rel: "self", href: `${base}/opds/new`, type: ACQ_TYPE },
      { rel: "up", href: `${base}/opds`, type: NAV_TYPE },
      { rel: "search", href: `${base}/opds/opensearch.xml`, type: "application/opensearchdescription+xml" },
    ],
    entries: rows.map((r) => bookToEntry(base, r)),
  };
  return new Response(renderAtom(feed), {
    status: 200,
    headers: { "Content-Type": ACQ_TYPE, "Cache-Control": "private, no-store" },
  });
}
