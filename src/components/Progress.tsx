"use client";

/**
 * Shared-m3 progress wrapper: solid determinate bar, morph for indeterminate.
 * If the caller-supplied label already contains a percent (e.g. "Downloading
 * 31% of 32.3 MB"), the right-hand percent readout is suppressed to avoid a
 * duplicate "...MB22%" rendering.
 */
export default function Progress({
  pct,
  label,
  indeterminate,
}: {
  pct?: number;
  label?: string;
  indeterminate?: boolean;
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(pct ?? 0)));
  const ariaLabel = label || (indeterminate ? "Working..." : `${clamped}% complete`);
  const labelHasPercent = typeof label === "string" && /\d%/.test(label);

  if (indeterminate) {
    return (
      <div aria-live="polite" style={{ width: "100%" }}>
        {label ? (
          <div
            className="m3-progress-label"
            style={{ marginBottom: "var(--m3-space-2)", color: "var(--m3-on-surface-variant)", fontFamily: "var(--m3-font-brand)" }}
          >
            {label}
          </div>
        ) : null}
        <div
          className="m3-progress-morph"
          role="progressbar"
          aria-label={ariaLabel}
          aria-busy="true"
        />
      </div>
    );
  }

  return (
    <div aria-live="polite" style={{ width: "100%" }}>
      {label ? (
        <div
          className="m3-progress-label"
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: "var(--m3-space-3)",
            marginBottom: "var(--m3-space-2)",
            color: "var(--m3-on-surface-variant)",
            fontFamily: "var(--m3-font-brand)",
          }}
        >
          <span>{label}</span>
          {typeof pct === "number" && !labelHasPercent ? (
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{clamped}%</span>
          ) : null}
        </div>
      ) : null}
      <div
        className="m3-linear-progress"
        role="progressbar"
        aria-label={ariaLabel}
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="m3-linear-progress-fill" style={{ width: `${clamped}%` }} />
      </div>
    </div>
  );
}
