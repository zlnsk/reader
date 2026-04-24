import { NextRequest } from "next/server";
import { requireOpdsAuth, publicBase } from "@/lib/opds-auth";
import { renderAtom, ACQ_TYPE, NAV_TYPE, Feed } from "@/lib/opds-feed";
import { fetchBooksPage, bookToEntry, paginationLinks } from "@/lib/opds-entries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireOpdsAuth(req);
  if (auth instanceof Response) return auth;
  const base = publicBase(req);
  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const per = Math.min(200, Math.max(1, Number(url.searchParams.get("per")) || 50));
  const { rows, total } = await fetchBooksPage(auth.email, { page, per, archived: false });
  const feed: Feed = {
    id: `${base}/opds/all?page=${page}`,
    title: "Reader — All books",
    updated: new Date().toISOString(),
    totalResults: total,
    itemsPerPage: per,
    startIndex: (page - 1) * per + 1,
    links: [
      ...paginationLinks(base, "/opds/all", page, per, total),
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
