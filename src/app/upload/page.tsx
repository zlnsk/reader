"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import AppNav from "@/components/AppNav";

const BP = process.env.NEXT_PUBLIC_BASE_PATH || "/Reader";

type Phase = "idle" | "uploading" | "extracting" | "error";
type UploadResult = { id: string; duplicate?: false } | { duplicate: true; existingId: string; title: string | null };

const ACCEPTED = ".pdf,.epub,.docx,.txt,.md,.markdown,.mobi,.azw3,.fb2";

export default function UploadPage() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [pct, setPct] = useState(0);
  const [stage, setStage] = useState("");
  const [errMsg, setErrMsg] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const router = useRouter();

  function xhrUpload(file: File): Promise<UploadResult> {
    return new Promise((resolve, reject) => {
      const fd = new FormData();
      fd.append("file", file);
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${BP}/api/upload`);
      xhr.responseType = "json";
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) setPct(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        const body = xhr.response;
        if (xhr.status === 409 && body?.error === "duplicate" && body?.existingId) {
          resolve({ duplicate: true, existingId: body.existingId, title: body.title ?? null });
          return;
        }
        if (xhr.status >= 200 && xhr.status < 300 && body?.id) {
          resolve({ id: body.id });
          return;
        }
        reject(new Error(body?.error || `Upload failed (${xhr.status})`));
      };
      xhr.onerror = () => reject(new Error("Network error"));
      xhr.send(fd);
    });
  }

  async function onFile(f: File) {
    setPhase("uploading");
    setStage(`Uploading ${f.name}`);
    setPct(0);
    setErrMsg("");
    try {
      const res = await xhrUpload(f);
      if ("duplicate" in res && res.duplicate) {
        router.push(`/?dup=${res.existingId}`);
        return;
      }
      const id = (res as { id: string }).id;
      setPhase("extracting");
      setStage("Preparing");
      setPct(0);
      for (let i = 0; i < 600; i++) {
        await new Promise((r) => setTimeout(r, 1200));
        const s = await fetch(`${BP}/api/books/${id}`).then((r) => r.json());
        if (s.status === "duplicate" && s.duplicate_of) {
          router.push(`/?dup=${s.duplicate_of}`);
          return;
        }
        if (s.status === "ready") { router.push(`/?new=${id}`); return; }
        if (s.status === "failed") throw new Error(s.error || "Extraction failed");
        setStage(s.status_detail || "Extracting");
        setPct(Number(s.progress_pct || 0));
      }
      throw new Error("Extraction timed out");
    } catch (e: any) {
      setPhase("error");
      setErrMsg(e.message);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer?.files?.[0];
    if (f) onFile(f);
  }

  return (
    <>
      <AppNav active="discover" showResume={false} />
      <div className="page">
        <section className="discover-hero">
          <div className="mono">Discover · Upload</div>
          <h1>
            Drop your books <em>here.</em>
          </h1>
          <p>EPUB, PDF (with a text layer), MOBI, AZW3, DOCX, TXT, or Markdown. We'll extract chapters, generate a cover, and mirror everything to your Android app.</p>
        </section>

        {phase === "idle" ? (
          <div
            className={`upload-zone${dragOver ? " drag-over" : ""}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") inputRef.current?.click(); }}
          >
            <div className="uicon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" style={{ width: 28, height: 28 }} strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 4v12M6 10l6-6 6 6" />
                <path d="M4 20h16" />
              </svg>
            </div>
            <h2>Drop a book here</h2>
            <p>Or click to choose. Up to 200&nbsp;MB per file.</p>
            <button type="button" className="btn btn-primary">Choose file</button>
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPTED}
              style={{ display: "none" }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
            />
            <div className="format-chips">
              <span className="format-chip">EPUB</span>
              <span className="format-chip">PDF</span>
              <span className="format-chip">MOBI</span>
              <span className="format-chip">AZW3</span>
              <span className="format-chip">DOCX</span>
              <span className="format-chip">TXT</span>
              <span className="format-chip">FB2</span>
            </div>
          </div>
        ) : (
          <div
            style={{
              maxWidth: 520,
              margin: "24px auto 64px",
              padding: 32,
              borderRadius: "var(--radius)",
              border: "1px solid var(--line)",
              background: "var(--paper-2)",
            }}
          >
            <h3 style={{ fontFamily: "var(--reader-serif)", fontSize: 24, margin: "0 0 16px", fontWeight: 500 }}>
              {phase === "uploading" ? "Uploading your book" : phase === "extracting" ? "Converting with AI" : "Something went wrong"}
            </h3>
            {phase !== "error" ? (
              <div>
                <div className="mono" style={{ marginBottom: 10, color: "var(--ink-2)" }}>{stage || "Working"}</div>
                <div className="bar" style={{ height: 6 }}>
                  <div className="bar-fill" style={{ width: `${pct}%`, transition: "width 400ms ease" }} />
                </div>
                <div className="mono" style={{ marginTop: 8, textAlign: "right" }}>{pct}%</div>
              </div>
            ) : (
              <div style={{ color: "var(--error)", fontSize: 14, marginBottom: 16 }}>{errMsg}</div>
            )}
            {phase === "error" ? (
              <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                <button type="button" className="btn btn-primary" onClick={() => { setPhase("idle"); setPct(0); }}>Try again</button>
                <Link href="/" className="btn btn-ghost">Back to library</Link>
              </div>
            ) : (
              <p style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 16 }}>
                {phase === "uploading" ? "Your file is being transferred to the server." : "Parsing the book, cleaning up typography, and structuring into chapters. This may take a minute."}
              </p>
            )}
          </div>
        )}

        <div className="sec-head">
          <h2>Other ways to add</h2>
        </div>
        <div className="add-methods">
          <Link href="/search" className="method">
            <div className="icon-tile">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" style={{ width: 22, height: 22 }} strokeLinecap="round">
                <circle cx="11" cy="11" r="7" />
                <path d="M20 20l-3.5-3.5" />
              </svg>
            </div>
            <h3>Search LibGen</h3>
            <p>Look up the title, grab the EPUB, import it.</p>
            <span className="arrow-link">Open search →</span>
          </Link>
          <Link href="/opds-client" className="method">
            <div className="icon-tile">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" style={{ width: 22, height: 22 }} strokeLinecap="round">
                <path d="M4 6h16M4 12h16M4 18h10" />
              </svg>
            </div>
            <h3>Browse OPDS</h3>
            <p>Calibre, Standard Ebooks, Gutenberg, and more.</p>
            <span className="arrow-link">Open OPDS →</span>
          </Link>
          <Link href="/" className="method">
            <div className="icon-tile">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" style={{ width: 22, height: 22 }} strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 4v16l7-4 7 4V4z" />
              </svg>
            </div>
            <h3>Back to library</h3>
            <p>See your books and pick up where you left off.</p>
            <span className="arrow-link">Go home →</span>
          </Link>
        </div>
      </div>
    </>
  );
}
