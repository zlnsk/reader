import { NextRequest } from "next/server";
import { publicBase } from "@/lib/opds-auth";
import { ACQ_TYPE, xmlEscape } from "@/lib/opds-feed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// OpenSearch description document. Referenced from nav feeds via
// <link rel="search" type="application/opensearchdescription+xml">.
// No auth required: it's a static pointer that tells clients how to query.
export async function GET(req: NextRequest) {
  const base = publicBase(req);
  const template = `${base}/opds/search?q={searchTerms}&amp;page={startPage?}&amp;per={count?}`;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/">
  <ShortName>Reader</ShortName>
  <Description>Search the Reader library.</Description>
  <InputEncoding>UTF-8</InputEncoding>
  <Url type="${xmlEscape(ACQ_TYPE)}" template="${template}"/>
</OpenSearchDescription>`;
  return new Response(xml, {
    status: 200,
    headers: { "Content-Type": "application/opensearchdescription+xml", "Cache-Control": "public, max-age=3600" },
  });
}
