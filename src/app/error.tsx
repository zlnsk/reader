"use client";

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (typeof window !== "undefined") {
      // eslint-disable-next-line no-console
      console.error(error);
    }
  }, [error]);

  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: "40px", color: "#1a1a17", background: "#f4f1ec" }}>
        <div style={{ maxWidth: 560, margin: "80px auto" }}>
          <h1 style={{ fontSize: 28, fontWeight: 500, marginBottom: 8 }}>Something went wrong</h1>
          <p style={{ color: "#6b6860", marginBottom: 20 }}>
            {error.message || "An unexpected error occurred."}
            {error.digest ? ` (ref: ${error.digest})` : ""}
          </p>
          <button
            onClick={reset}
            style={{
              padding: "10px 18px",
              borderRadius: 8,
              border: "1px solid #d6cebf",
              background: "#fbfaf7",
              cursor: "pointer",
              fontSize: 14,
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
