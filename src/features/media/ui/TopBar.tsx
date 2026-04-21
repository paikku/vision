"use client";

import { useStore } from "@/lib/store";

export function TopBar() {
  const media = useStore((s) => s.media);
  const annotations = useStore((s) => s.annotations);
  const frames = useStore((s) => s.frames);
  const reset = useStore((s) => s.reset);
  const exportJson = useStore((s) => s.exportJson);

  const onExport = () => {
    const blob = new Blob([exportJson()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${media?.name?.replace(/\.[^.]+$/, "") ?? "annotations"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--color-line)] bg-[var(--color-surface)] px-4">
      <div className="flex items-center gap-3">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="3" />
            <circle cx="9" cy="9" r="1.5" fill="currentColor" />
          </svg>
        </div>
        <div className="text-sm font-semibold tracking-tight">
          Vision Labeler
        </div>
        {media && (
          <div className="ml-3 flex items-center gap-2 text-xs text-[var(--color-muted)]">
            <span className="rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 uppercase tracking-wide text-[10px]">
              {media.kind}
            </span>
            <span className="max-w-[40ch] truncate">{media.name}</span>
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 text-xs">
        {media && (
          <span className="text-[var(--color-muted)]">
            {frames.length} frames · {annotations.length} labels
          </span>
        )}
        <button
          type="button"
          onClick={onExport}
          disabled={annotations.length === 0}
          className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-xs font-medium text-black disabled:opacity-40"
        >
          Export JSON
        </button>
        {media && (
          <button
            type="button"
            onClick={() => reset()}
            className="rounded-md border border-[var(--color-line)] px-3 py-1.5 text-xs hover:border-[var(--color-danger)] hover:text-[var(--color-danger)]"
          >
            Close
          </button>
        )}
      </div>
    </header>
  );
}
