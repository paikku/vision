"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@/lib/store";

type SortOrder = "added" | "time";
type FilterMode = "all" | "unlabeled";

export function FrameStrip() {
  const frames = useStore((s) => s.frames);
  const activeFrameId = useStore((s) => s.activeFrameId);
  const setActiveFrame = useStore((s) => s.setActiveFrame);
  const removeFrame = useStore((s) => s.removeFrame);
  const annotations = useStore((s) => s.annotations);
  const classes = useStore((s) => s.classes);
  const exceptedFrameIds = useStore((s) => s.exceptedFrameIds);
  const toggleFrameException = useStore((s) => s.toggleFrameException);

  const [sort, setSort] = useState<SortOrder>("added");
  const [filter, setFilter] = useState<FilterMode>("all");
  const listRef = useRef<HTMLUListElement>(null);

  // annotation count per frame
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const a of annotations) {
      map.set(a.frameId, (map.get(a.frameId) ?? 0) + 1);
    }
    return map;
  }, [annotations]);

  // class breakdown per frame: { classId → count }
  const classCounts = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    for (const a of annotations) {
      let inner = map.get(a.frameId);
      if (!inner) { inner = new Map(); map.set(a.frameId, inner); }
      inner.set(a.classId, (inner.get(a.classId) ?? 0) + 1);
    }
    return map;
  }, [annotations]);

  const sorted = useMemo(() => {
    const list = [...frames];
    if (sort === "time") {
      list.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
    }
    return list;
  }, [frames, sort]);

  const filtered = useMemo(() => {
    if (filter === "all") return sorted;
    return sorted.filter((f) => (counts.get(f.id) ?? 0) === 0 && !exceptedFrameIds[f.id]);
  }, [sorted, filter, counts, exceptedFrameIds]);

  // Scroll active frame into view when selection changes.
  useEffect(() => {
    if (!activeFrameId || !listRef.current) return;
    const item = listRef.current.querySelector<HTMLElement>(`[data-frame-id="${activeFrameId}"]`);
    item?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeFrameId]);

  if (frames.length === 0) {
    return (
      <div className="px-3 py-6 text-center text-xs text-[var(--color-muted)]">
        Capture frames to start labeling.
      </div>
    );
  }

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      {/* Sort + filter controls */}
      <div className="flex shrink-0 flex-col gap-1 border-b border-[var(--color-line)] px-2 py-1.5">
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-[var(--color-muted)] w-8 shrink-0">정렬</span>
          {(["added", "time"] as SortOrder[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSort(s)}
              className={[
                "rounded px-2 py-0.5 text-[10px] transition",
                sort === s
                  ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                  : "text-[var(--color-muted)] hover:text-[var(--color-text)]",
              ].join(" ")}
            >
              {s === "added" ? "추가순" : "시간순"}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-[var(--color-muted)] w-8 shrink-0">필터</span>
          {(["all", "unlabeled"] as FilterMode[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={[
                "rounded px-2 py-0.5 text-[10px] transition",
                filter === f
                  ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                  : "text-[var(--color-muted)] hover:text-[var(--color-text)]",
              ].join(" ")}
            >
              {f === "all" ? "전체" : "미라벨"}
            </button>
          ))}
        </div>
      </div>

      <ul ref={listRef} className="flex-1 space-y-2 overflow-y-auto p-3">
        {filtered.map((f, i) => {
          const active = f.id === activeFrameId;
          const count = counts.get(f.id) ?? 0;
          const excepted = !!exceptedFrameIds[f.id];
          const frameClassCounts = classCounts.get(f.id);
          const originalIdx = frames.indexOf(f);

          return (
            <li key={f.id} data-frame-id={f.id}>
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

                {/* Footer: index + label + annotation count */}
                <div className="flex items-center justify-between bg-[var(--color-surface)] px-2 py-1 text-[11px] text-[var(--color-muted)]">
                  <span className="tabular-nums truncate">
                    #{String(originalIdx + 1).padStart(2, "0")} · {f.label}
                  </span>
                  <span className="ml-1 shrink-0 rounded-full bg-[var(--color-surface-2)] px-1.5 text-[10px] text-[var(--color-text)]">
                    {count}
                  </span>
                </div>

                {/* Class breakdown badges or except indicator (bottom-left, same row) */}
                <div className="flex flex-wrap gap-1 bg-[var(--color-surface)] px-2 pb-1 min-h-[18px]">
                  {count === 0 ? (
                    <span
                      role="button"
                      aria-label={excepted ? "제외 해제" : "라벨 제외"}
                      title={excepted ? "미라벨 필터에서 제외 해제" : "미라벨 필터에서 제외"}
                      onClick={(e) => { e.stopPropagation(); toggleFrameException(f.id); }}
                      className={[
                        "flex items-center gap-0.5 rounded-full px-1.5 py-px text-[10px] cursor-pointer transition",
                        excepted
                          ? "bg-[var(--color-accent)]/80 text-white"
                          : "invisible group-hover:visible bg-[var(--color-surface-2)] text-[var(--color-muted)]",
                      ].join(" ")}
                    >
                      {excepted ? "제외됨" : "제외"}
                    </span>
                  ) : (
                    frameClassCounts && [...frameClassCounts.entries()].map(([cid, n]) => {
                      const klass = classes.find((c) => c.id === cid);
                      if (!klass) return null;
                      return (
                        <span
                          key={cid}
                          className="flex items-center gap-0.5 rounded-full px-1.5 py-px text-[10px] text-white"
                          style={{ background: klass.color }}
                          title={klass.name}
                        >
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-white/50" />
                          {n}
                        </span>
                      );
                    })
                  )}
                </div>

                {/* Remove button */}
                <span
                  role="button"
                  aria-label="Remove frame"
                  onClick={(e) => { e.stopPropagation(); removeFrame(f.id); }}
                  className="absolute right-1 top-1 hidden h-6 w-6 cursor-pointer items-center justify-center rounded-full bg-black/60 text-xs text-white group-hover:flex"
                >
                  ×
                </span>
              </button>
            </li>
          );
        })}
        {filtered.length === 0 && (
          <li className="py-4 text-center text-xs text-[var(--color-muted)]">
            {filter === "unlabeled" ? "미라벨 프레임 없음" : "프레임 없음"}
          </li>
        )}
      </ul>
    </div>
  );
}
