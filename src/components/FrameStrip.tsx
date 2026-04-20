"use client";

import { useMemo } from "react";
import { useStore } from "@/lib/store";

export function FrameStrip() {
  const frames = useStore((s) => s.frames);
  const activeFrameId = useStore((s) => s.activeFrameId);
  const setActiveFrame = useStore((s) => s.setActiveFrame);
  const removeFrame = useStore((s) => s.removeFrame);
  const annotations = useStore((s) => s.annotations);
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const a of annotations) {
      map.set(a.frameId, (map.get(a.frameId) ?? 0) + 1);
    }
    return map;
  }, [annotations]);

  if (frames.length === 0) {
    return (
      <div className="px-3 py-6 text-center text-xs text-[var(--color-muted)]">
        Capture frames to start labeling.
      </div>
    );
  }

  return (
    <ul className="flex-1 space-y-2 overflow-y-auto p-3">
      {frames.map((f, i) => {
        const active = f.id === activeFrameId;
        const count = counts.get(f.id) ?? 0;
        return (
          <li key={f.id}>
            <button
              type="button"
              onClick={() => setActiveFrame(f.id)}
              className={[
                "group relative block w-full overflow-hidden rounded-md border text-left transition",
                active
                  ? "border-[var(--color-accent)] ring-2 ring-[var(--color-accent)]/30"
                  : "border-[var(--color-line)] hover:border-[var(--color-muted)]",
              ].join(" ")}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={f.url}
                alt={f.label}
                className="aspect-video w-full bg-black object-contain"
              />
              <div className="flex items-center justify-between bg-[var(--color-surface)] px-2 py-1 text-[11px] text-[var(--color-muted)]">
                <span className="tabular-nums">
                  #{String(i + 1).padStart(2, "0")} · {f.label}
                </span>
                <span className="rounded-full bg-[var(--color-surface-2)] px-1.5 text-[10px] text-[var(--color-text)]">
                  {count}
                </span>
              </div>
              <span
                role="button"
                aria-label="Remove frame"
                onClick={(e) => {
                  e.stopPropagation();
                  removeFrame(f.id);
                }}
                className="absolute right-1 top-1 hidden h-6 w-6 cursor-pointer items-center justify-center rounded-full bg-black/60 text-xs text-white group-hover:flex"
              >
                ×
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
