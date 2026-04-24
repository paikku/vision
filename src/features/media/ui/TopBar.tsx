"use client";

import { useStore } from "@/lib/store";
import { Badge, Button } from "@/shared/ui";

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
        <div className="flex h-7 w-7 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="3" />
            <circle cx="9" cy="9" r="1.5" fill="currentColor" />
          </svg>
        </div>
        <div className="text-[var(--text-md)] font-semibold tracking-tight text-[var(--color-text-strong)]">
          Vision Labeler
        </div>
        {media && (
          <div className="ml-3 flex items-center gap-2 text-[var(--text-sm)] text-[var(--color-muted)]">
            <Badge tone="outline" size="xs" shape="pill" className="uppercase tracking-wide">
              {media.kind}
            </Badge>
            <span className="max-w-[40ch] truncate">{media.name}</span>
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 text-[var(--text-sm)]">
        {media && (
          <span className="text-[var(--color-muted)]">
            {frames.length} frames · {annotations.length} labels
          </span>
        )}
        <Button
          variant="primary"
          size="sm"
          onClick={onExport}
          disabled={annotations.length === 0}
        >
          Export JSON
        </Button>
        {media && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => reset()}
            className="hover:border-[var(--color-danger)] hover:text-[var(--color-danger)]"
          >
            Close
          </Button>
        )}
      </div>
    </header>
  );
}
