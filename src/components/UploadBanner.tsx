"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function UploadBanner({ kind, title }: { kind: "new" | "dup"; title: string | null }) {
  const router = useRouter();
  useEffect(() => {
    const t = setTimeout(() => router.replace("/"), 6000);
    return () => clearTimeout(t);
  }, [router]);

  const displayTitle = (title || "Untitled").trim();
  const isNew = kind === "new";
  return (
    <div role="status" className={`banner ${isNew ? "success" : "warn"}`}>
      <span style={{ fontSize: 20, lineHeight: 1 }}>{isNew ? "✨" : "ℹ️"}</span>
      <span style={{ flex: 1 }}>
        {isNew ? (
          <><strong>Added to your library:</strong> &ldquo;{displayTitle}&rdquo;</>
        ) : (
          <><strong>Already in your library:</strong> &ldquo;{displayTitle}&rdquo;</>
        )}
      </span>
      <button onClick={() => router.replace("/")} aria-label="Dismiss">Dismiss</button>
    </div>
  );
}
