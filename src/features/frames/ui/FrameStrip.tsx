"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { selectVisibleFrames, useStore } from "@/lib/store";
import type { FrameFilterMode, FrameSortOrder } from "../slice";

// Virtualization constants. Item height is measured at runtime from the first
// rendered row so we adapt to any layout tweaks — these are only the initial
// estimate and the overscan buffer.
const DEFAULT_ITEM_HEIGHT = 200;
const OVERSCAN = 4;
const ITEM_GAP = 8; // matches the old space-y-2 gap between rows
const LIST_PADDING = 12; // matches p-3 on the scroll container

export function FrameStrip() {
  const frames = useStore((s) => s.frames);
  const activeFrameId = useStore((s) => s.activeFrameId);
  const setActiveFrame = useStore((s) => s.setActiveFrame);
  const removeFrame = useStore((s) => s.removeFrame);
  const annotations = useStore((s) => s.annotations);
  const classes = useStore((s) => s.classes);
  const exceptedFrameIds = useStore((s) => s.exceptedFrameIds);
  const toggleFrameException = useStore((s) => s.toggleFrameException);
  const sort = useStore((s) => s.frameSortOrder);
  const filter = useStore((s) => s.frameFilterMode);
  const setSort = useStore((s) => s.setFrameSortOrder);
  const setFilter = useStore((s) => s.setFrameFilterMode);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [itemHeight, setItemHeight] = useState(DEFAULT_ITEM_HEIGHT);
  const scrollRafRef = useRef<number | null>(null);

  // Coalesce scroll updates to one per frame — firing setState on every
  // pixel of wheel scroll is what makes long strips feel sticky.
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (scrollRafRef.current !== null) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      setScrollTop(el.scrollTop);
    });
  }, []);

  useEffect(() => {
    return () => {
      if (scrollRafRef.current !== null) {
        cancelAnimationFrame(scrollRafRef.current);
      }
    };
  }, []);

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

  // Precompute original insertion index per frame id. `frames.indexOf(f)` in
  // the render loop is O(n²) when the strip holds thousands of frames.
  const originalIndex = useMemo(() => {
    const map = new Map<string, number>();
    frames.forEach((f, i) => map.set(f.id, i));
    return map;
  }, [frames]);

  // Class lookup by id — same reason: avoid per-row linear scans.
  const classById = useMemo(() => {
    const map = new Map<string, (typeof classes)[number]>();
    for (const c of classes) map.set(c.id, c);
    return map;
  }, [classes]);

  // Visible list mirrors what `useKeyboardShortcuts` uses for 1/2 nav, so
  // keyboard stepping and the strip always agree on the current slice.
  // Compute via useMemo rather than a zustand selector because the selector
  // returns a new array each call, which would thrash referential equality.
  const filtered = useMemo(
    () =>
      selectVisibleFrames({
        frames,
        annotations,
        exceptedFrameIds,
        frameSortOrder: sort,
        frameFilterMode: filter,
      }),
    [frames, annotations, exceptedFrameIds, sort, filter],
  );

  // Total scrollable height for all items. The last item doesn't need a
  // trailing gap, so one `itemHeight` unit already over-counts by the gap.
  // That's fine — it just leaves a tiny bit of dead space at the bottom.
  const totalHeight = filtered.length * itemHeight;

  // Track viewport size so the visible range stays correct on resize.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setViewportHeight(el.clientHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Measure actual row stride (item height + gap) from the first rendered
  // row. We pass this callback via ref on the first visible item below.
  const measureItem = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    const h = node.getBoundingClientRect().height + ITEM_GAP;
    if (h > ITEM_GAP) {
      setItemHeight((prev) => (Math.abs(prev - h) > 0.5 ? h : prev));
    }
  }, []);

  const startIdx = Math.max(
    0,
    Math.floor((scrollTop - LIST_PADDING) / itemHeight) - OVERSCAN,
  );
  const endIdx = Math.min(
    filtered.length,
    Math.ceil((scrollTop - LIST_PADDING + viewportHeight) / itemHeight) +
      OVERSCAN,
  );
  const visibleSlice = filtered.slice(startIdx, endIdx);

  // Scroll active frame into view when selection changes. With virtualization
  // the item may not be in the DOM, so compute the target scrollTop from the
  // active frame's index in `filtered`.
  useEffect(() => {
    const el = scrollRef.current;
    if (!activeFrameId || !el) return;
    const idx = filtered.findIndex((f) => f.id === activeFrameId);
    if (idx < 0) return;
    const itemTop = LIST_PADDING + idx * itemHeight;
    const itemBottom = itemTop + itemHeight;
    const viewTop = el.scrollTop;
    const viewBottom = viewTop + el.clientHeight;
    if (itemTop < viewTop) {
      el.scrollTo({ top: itemTop - LIST_PADDING, behavior: "smooth" });
    } else if (itemBottom > viewBottom) {
      el.scrollTo({
        top: itemBottom - el.clientHeight + LIST_PADDING,
        behavior: "smooth",
      });
    }
  }, [activeFrameId, filtered, itemHeight]);

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
          {(["added", "time"] as FrameSortOrder[]).map((s) => (
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
          {(["all", "unlabeled"] as FrameFilterMode[]).map((f) => (
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

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto"
      >
        {filtered.length === 0 ? (
          <p className="py-4 text-center text-xs text-[var(--color-muted)]">
            {filter === "unlabeled" ? "미라벨 프레임 없음" : "프레임 없음"}
          </p>
        ) : (
          <div
            role="list"
            className="relative px-3"
            style={{
              height: totalHeight + LIST_PADDING * 2,
            }}
          >
            {visibleSlice.map((f, i) => {
              const absIdx = startIdx + i;
              const active = f.id === activeFrameId;
              const count = counts.get(f.id) ?? 0;
              const excepted = !!exceptedFrameIds[f.id];
              const frameClassCounts = classCounts.get(f.id);
              const originalIdx = originalIndex.get(f.id) ?? absIdx;

              return (
                <div
                  key={f.id}
                  role="listitem"
                  data-frame-id={f.id}
                  ref={i === 0 ? measureItem : undefined}
                  style={{
                    position: "absolute",
                    top: LIST_PADDING + absIdx * itemHeight,
                    left: LIST_PADDING,
                    right: LIST_PADDING,
                  }}
                >
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
                      loading="lazy"
                      decoding="async"
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
                          const klass = classById.get(cid);
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
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
