"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { selectVisibleFrames, useStore } from "@/lib/store";
import { Badge, SegmentedControl, cn } from "@/shared/ui";
import type { FrameFilterMode, FrameSortOrder } from "../slice";

// Virtualization constants. Item height is measured at runtime from the first
// rendered row — these are only the initial estimate and the overscan buffer.
const DEFAULT_ITEM_HEIGHT = 200;
const OVERSCAN = 4;
const ITEM_GAP = 8;
const LIST_PADDING = 12;

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

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const a of annotations) {
      map.set(a.frameId, (map.get(a.frameId) ?? 0) + 1);
    }
    return map;
  }, [annotations]);

  const classCounts = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    for (const a of annotations) {
      let inner = map.get(a.frameId);
      if (!inner) {
        inner = new Map();
        map.set(a.frameId, inner);
      }
      inner.set(a.classId, (inner.get(a.classId) ?? 0) + 1);
    }
    return map;
  }, [annotations]);

  const originalIndex = useMemo(() => {
    const map = new Map<string, number>();
    frames.forEach((f, i) => map.set(f.id, i));
    return map;
  }, [frames]);

  const classById = useMemo(() => {
    const map = new Map<string, (typeof classes)[number]>();
    for (const c of classes) map.set(c.id, c);
    return map;
  }, [classes]);

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

  const totalHeight = filtered.length * itemHeight;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setViewportHeight(el.clientHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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
    Math.ceil((scrollTop - LIST_PADDING + viewportHeight) / itemHeight) + OVERSCAN,
  );
  const visibleSlice = filtered.slice(startIdx, endIdx);

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
      <div className="px-3 py-6 text-center text-[var(--text-xs)] text-[var(--color-muted)]">
        Capture frames to start labeling.
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-col gap-1.5 border-b border-[var(--color-line)] px-2 py-2">
        <div className="flex items-center gap-2">
          <span className="w-8 shrink-0 text-[var(--text-2xs)] uppercase tracking-wide text-[var(--color-muted)]">
            정렬
          </span>
          <SegmentedControl<FrameSortOrder>
            size="sm"
            value={sort}
            onChange={setSort}
            options={[
              { value: "added", label: "추가순" },
              { value: "time", label: "시간순" },
            ]}
            aria-label="프레임 정렬"
            className="flex-1"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="w-8 shrink-0 text-[var(--text-2xs)] uppercase tracking-wide text-[var(--color-muted)]">
            필터
          </span>
          <SegmentedControl<FrameFilterMode>
            size="sm"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: "전체" },
              { value: "unlabeled", label: "미라벨" },
            ]}
            aria-label="프레임 필터"
            className="flex-1"
          />
        </div>
      </div>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto"
      >
        {filtered.length === 0 ? (
          <p className="py-4 text-center text-[var(--text-xs)] text-[var(--color-muted)]">
            {filter === "unlabeled" ? "미라벨 프레임 없음" : "프레임 없음"}
          </p>
        ) : (
          <div
            role="list"
            className="relative px-3"
            style={{ height: totalHeight + LIST_PADDING * 2 }}
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
                    className={cn(
                      "group relative block w-full overflow-hidden rounded-[var(--radius-md)] border text-left transition-colors",
                      active
                        ? "border-[var(--color-accent)] ring-2 ring-[var(--color-accent)]/30"
                        : "border-[var(--color-line)] hover:border-[var(--color-line-strong)]",
                    )}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={f.url}
                      alt={f.label}
                      loading="lazy"
                      decoding="async"
                      className="aspect-video w-full bg-black object-contain"
                    />

                    <div className="flex items-center justify-between bg-[var(--color-surface)] px-2 py-1 text-[var(--text-2xs)] text-[var(--color-muted)]">
                      <span className="truncate tabular-nums">
                        #{String(originalIdx + 1).padStart(2, "0")} · {f.label}
                      </span>
                      <Badge tone="neutral" size="xs" shape="pill" className="ml-1 shrink-0">
                        {count}
                      </Badge>
                    </div>

                    <div className="flex min-h-[18px] flex-wrap gap-1 bg-[var(--color-surface)] px-2 pb-1">
                      {count === 0 ? (
                        <span
                          role="button"
                          aria-label={excepted ? "제외 해제" : "라벨 제외"}
                          title={excepted ? "미라벨 필터에서 제외 해제" : "미라벨 필터에서 제외"}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleFrameException(f.id);
                          }}
                          className={cn(
                            "inline-flex cursor-pointer items-center gap-0.5 rounded-[var(--radius-full)] px-2 py-px text-[var(--text-2xs)] transition-colors",
                            excepted
                              ? "bg-[var(--color-accent)]/80 text-white"
                              : "invisible bg-[var(--color-surface-2)] text-[var(--color-muted)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text)] group-hover:visible",
                          )}
                        >
                          {excepted ? "제외됨" : "제외"}
                        </span>
                      ) : (
                        frameClassCounts &&
                        [...frameClassCounts.entries()].map(([cid, n]) => {
                          const klass = classById.get(cid);
                          if (!klass) return null;
                          return (
                            <Badge
                              key={cid}
                              size="xs"
                              shape="pill"
                              color={klass.color}
                              title={klass.name}
                              swatch={<span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-70" />}
                            >
                              {n}
                            </Badge>
                          );
                        })
                      )}
                    </div>

                    <span
                      role="button"
                      aria-label="Remove frame"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeFrame(f.id);
                      }}
                      className="absolute right-1 top-1 hidden h-6 w-6 cursor-pointer items-center justify-center rounded-[var(--radius-full)] bg-black/60 text-[var(--text-xs)] text-white transition-colors hover:bg-[var(--color-danger)] group-hover:flex"
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
