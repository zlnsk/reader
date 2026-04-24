// Shared builder for book -> Atom entry. Used by all acquisition feeds.
import { q } from "@/lib/db";
import { ACQ_REL, ACQ_TYPE, FeedEntry, IMG_REL, THUMB_REL, bookMime, isoOrNow } from "@/lib/opds-feed";
import path from "node:path";

export type BookRow = {
  id: string;
  title: string | null;
  author: string | null;
  word_count: number | null;
  created_at: string;
  updated_at: string;
  source_filename: string | null;
  source_path: string | null;
  cover_path: string | null;
  archived: boolean;
};

export type PageOpts = {
  page: number;
  per: number;
  archived?: boolean | "all";
  query?: string;
};

export async function fetchBooksPage(email: string, opts: PageOpts): Promise<{ rows: BookRow[]; total: number }> {
  const per = Math.min(Math.max(opts.per | 0, 1), 200);
  const page = Math.max(opts.page | 0, 1);
  const offset = (page - 1) * per;
  const where: string[] = ["b.owner_email = $1", "b.status = 'ready'"];
  const params: any[] = [email];
  if (opts.archived === true) where.push("b.archived = true");
  else if (opts.archived === "all") { /* no filter */ }
  else where.push("b.archived = false");
  if (opts.query) {
    params.push(`%${opts.query}%`);
    const i = params.length;
    where.push(`(b.title ILIKE $${i} OR b.author ILIKE $${i})`);
  }
  const whereSql = where.join(" AND ");
  const rows = await q<BookRow>(
    `SELECT id, title, author, word_count, created_at, updated_at,
            source_filename, source_path, cover_path, archived
       FROM books b WHERE ${whereSql}
       ORDER BY b.created_at DESC
       LIMIT ${per} OFFSET ${offset}`,
    params
  );
  const totalRows = await q<{ c: number }>(`SELECT COUNT(*)::int AS c FROM books b WHERE ${whereSql}`, params);
  return { rows, total: totalRows[0]?.c ?? 0 };
}

export function bookToEntry(base: string, b: BookRow): FeedEntry {
  const ext = b.source_filename ? path.extname(b.source_filename).slice(1).toLowerCase() : "";
  const mime = bookMime(ext);
  const links = [] as FeedEntry["links"];
  links.push({
    rel: ACQ_REL,
    href: `${base}/opds/download/${b.id}`,
    type: mime,
    title: "Download",
  });
  if (b.cover_path) {
    links.push({ rel: IMG_REL, href: `${base}/opds/cover/${b.id}`, type: "image/jpeg" });
    links.push({ rel: THUMB_REL, href: `${base}/opds/cover/${b.id}`, type: "image/jpeg" });
  }
  const summaryBits: string[] = [];
  if (b.word_count) summaryBits.push(`${b.word_count.toLocaleString()} words`);
  if (b.archived) summaryBits.push("archived");
  return {
    id: `urn:uuid:${b.id}`,
    title: b.title || b.source_filename || "Untitled",
    updated: isoOrNow(b.updated_at || b.created_at),
    published: isoOrNow(b.created_at),
    authors: b.author ? [{ name: b.author }] : undefined,
    summary: summaryBits.join(" · ") || undefined,
    links,
  };
}

export function paginationLinks(base: string, selfPath: string, page: number, per: number, total: number): Array<{ rel: string; href: string; type: string }> {
  const last = Math.max(1, Math.ceil(total / per));
  const withPage = (n: number) => {
    const u = new URL(selfPath, "http://x");
    u.searchParams.set("page", String(n));
    u.searchParams.set("per", String(per));
    return `${base}${u.pathname}${u.search}`;
  };
  const links: Array<{ rel: string; href: string; type: string }> = [];
  links.push({ rel: "self", href: withPage(page), type: ACQ_TYPE });
  links.push({ rel: "first", href: withPage(1), type: ACQ_TYPE });
  links.push({ rel: "last", href: withPage(last), type: ACQ_TYPE });
  if (page > 1) links.push({ rel: "previous", href: withPage(page - 1), type: ACQ_TYPE });
  if (page < last) links.push({ rel: "next", href: withPage(page + 1), type: ACQ_TYPE });
  return links;
}
