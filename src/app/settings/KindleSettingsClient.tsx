"use client";
import { useEffect, useState, useCallback } from "react";
import { apiFetch } from "@/lib/csrf-client";

const BP = process.env.NEXT_PUBLIC_BASE_PATH || "/Reader";
const KINDLE_RE = /^[^\s@]+@(?:kindle\.com|free\.kindle\.com)$/i;

type Status = { kind: "idle" | "saving" | "saved" | "error"; msg?: string };

export default function KindleSettingsClient({ initialEmail }: { initialEmail: string }) {
  const [email, setEmail] = useState<string>(initialEmail);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [dirty, setDirty] = useState<boolean>(false);

  useEffect(() => {
    setDirty(email.trim() !== initialEmail.trim());
  }, [email, initialEmail]);

  const save = useCallback(async () => {
    const trimmed = email.trim().toLowerCase();
    if (trimmed && !KINDLE_RE.test(trimmed)) {
      setStatus({ kind: "error", msg: "Must end in @kindle.com or @free.kindle.com" });
      return;
    }
    setStatus({ kind: "saving" });
    try {
      const res = await apiFetch(`${BP}/api/prefs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kindleEmail: trimmed }),
      });
      if (!res.ok) throw new Error(await res.text());
      setStatus({ kind: "saved", msg: "Saved" });
      setDirty(false);
      setTimeout(() => setStatus({ kind: "idle" }), 2000);
    } catch (err: any) {
      setStatus({ kind: "error", msg: err?.message || "Save failed" });
    }
  }, [email]);

  const clear = useCallback(async () => {
    setEmail("");
    setStatus({ kind: "saving" });
    try {
      const res = await apiFetch(`${BP}/api/prefs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kindleEmail: "" }),
      });
      if (!res.ok) throw new Error(await res.text());
      setStatus({ kind: "saved", msg: "Removed" });
      setDirty(false);
      setTimeout(() => setStatus({ kind: "idle" }), 2000);
    } catch (err: any) {
      setStatus({ kind: "error", msg: err?.message || "Remove failed" });
    }
  }, []);

  return (
    <section style={{ marginBottom: 32 }}>
      <h2 style={{ fontSize: 20, margin: "0 0 4px", fontFamily: "var(--reader-serif)", fontWeight: 500 }}>
        Send to Kindle
      </h2>
      <p style={{ fontSize: 14, color: "var(--ink-2)", maxWidth: 560, marginTop: 0, marginBottom: 14 }}>
        Save your personal Kindle address and Reader will be able to email a formatted
        EPUB of any book in your library with one click. Amazon requires two things first:
      </p>
      <ol style={{ fontSize: 14, color: "var(--ink-2)", maxWidth: 600, paddingLeft: 20, marginBottom: 18 }}>
        <li style={{ marginBottom: 4 }}>
          Find your Kindle address at{" "}
          <a
            href="https://www.amazon.com/hz/mycd/digital-console/alldevices"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "var(--accent-ink, #7b3f21)", textDecoration: "underline" }}
          >
            Manage Your Content and Devices
          </a>
          . It looks like <code>yourname_abc123@kindle.com</code>.
        </li>
        <li>
          Add <code>noreply@mail.example.com</code> to your{" "}
          <a
            href="https://www.amazon.com/hz/mycd/myx#/home/settings/payment"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "var(--accent-ink, #7b3f21)", textDecoration: "underline" }}
          >
            approved personal document email list
          </a>{" "}
          — otherwise Amazon drops the document silently.
        </li>
      </ol>

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", maxWidth: 560 }}>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="yourname_abc123@kindle.com"
          autoComplete="off"
          spellCheck={false}
          style={{
            flex: 1,
            minWidth: 240,
            padding: "9px 12px",
            fontFamily: "var(--reader-mono)",
            fontSize: 14,
            border: "1px solid var(--line)",
            borderRadius: 6,
            background: "var(--paper, transparent)",
            color: "var(--ink)",
          }}
          onKeyDown={(e) => { if (e.key === "Enter" && dirty) save(); }}
        />
        <button
          type="button"
          className="btn btn-primary"
          disabled={!dirty || status.kind === "saving"}
          onClick={save}
        >
          {status.kind === "saving" ? "Saving…" : "Save"}
        </button>
        {initialEmail ? (
          <button
            type="button"
            className="btn btn-ghost"
            disabled={status.kind === "saving"}
            onClick={clear}
            title="Clear the saved Kindle address"
          >
            Remove
          </button>
        ) : null}
      </div>
      {status.msg ? (
        <div
          style={{
            marginTop: 10,
            fontSize: 13,
            color: status.kind === "error" ? "#b33838" : "var(--ink-2)",
          }}
          role="status"
        >
          {status.msg}
        </div>
      ) : null}
    </section>
  );
}
