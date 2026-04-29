"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { selectVisibleFrames, useStore } from "@/lib/store";
import type { FrameSortOrder } from "../slice";

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
  const classifications = useStore((s) => s.classifications);
  const classes = useStore((s) => s.classes);
  const taskType = useStore((s) => s.taskType);
  const exceptedFrameIds = useStore((s) => s.exceptedFrameIds);
  const toggleFrameException = useStore((s) => s.toggleFrameException);
  const sort = useStore((s) => s.frameSortOrder);
  const unlabeledOnly = useStore((s) => s.unlabeledOnly);
  const rangeFilterEnabled = useStore((s) => s.rangeFilterEnabled);
  const frameRange = useStore((s) => s.frameRange);
  const setSort = useStore((s) => s.setFrameSortOrder);
  const setUnlabeledOnly = useStore((s) => s.setUnlabeledOnly);
  const setRangeFilterEnabled = useStore((s) => s.setRangeFilterEnabled);

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

  // Per-image label count: shape annotations + classifications.
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const a of annotations) {
      map.set(a.imageId, (map.get(a.imageId) ?? 0) + 1);
    }
    for (const c of classifications) {
      map.set(c.imageId, (map.get(c.imageId) ?? 0) + 1);
    }
    return map;
  }, [annotations, classifications]);

  // Per-image class breakdown (combines annotations + classifications).
  const classCounts = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    const bump = (imageId: string, classId: string) => {
      let inner = map.get(imageId);
      if (!inner) {
        inner = new Map();
        map.set(imageId, inner);
      }
      inner.set(classId, (inner.get(classId) ?? 0) + 1);
    };
    for (const a of annotations) bump(a.imageId, a.classId);
    for (const c of classifications) bump(c.imageId, c.classId);
    return map;
  }, [annotations, classifications]);

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
        classifications,
        exceptedFrameIds,
        frameSortOrder: sort,
        unlabeledOnly,
        rangeFilterEnabled,
        frameRange,
      }),
    [
      frames,
      annotations,
      classifications,
      exceptedFrameIds,
      sort,
      unlabeledOnly,
      rangeFilterEnabled,
      frameRange,
    ],
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
    Math.ceil((scrollTop - LIST_PADDING + viewportHeight) / itemHeight) +
      OVERSCAN,
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
      <div className="px-3 py-6 text-center text-xs text-[var(--color-muted)]">
        {taskType === "classify"
          ? "이 라벨셋에 이미지가 없습니다."
          : "Capture frames to start labeling."}
      </div>
    );
  }

  const showRangeButton = !!frameRange;

  return (
    <div className="flex flex-1 min-h-0 flex-col">
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
          <button
            type="button"
            onClick={() => setUnlabeledOnly(!unlabeledOnly)}
            className={[
              "rounded px-2 py-0.5 text-[10px] transition",
              unlabeledOnly
                ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                : "text-[var(--color-muted)] hover:text-[var(--color-text)]",
            ].join(" ")}
          >
            미라벨
          </button>
          {showRangeButton && (
            <button
              type="button"
              onClick={() => setRangeFilterEnabled(!rangeFilterEnabled)}
              className={[
                "rounded px-2 py-0.5 text-[10px] transition",
                rangeFilterEnabled
                  ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                  : "text-[var(--color-muted)] hover:text-[var(--color-text)]",
              ].join(" ")}
            >
              범위
            </button>
          )}
        </div>
      </div>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto"
      >
        {filtered.length === 0 ? (
          <p className="py-4 text-center text-xs text-[var(--color-muted)]">
            {unlabeledOnly || rangeFilterEnabled ? "조건에 맞는 항목 없음" : "프레임 없음"}
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

                    <div className="flex items-center justify-between bg-[var(--color-surface)] px-2 py-1 text-[11px] text-[var(--color-muted)]">
                      <span className="tabular-nums truncate">
                        #{String(originalIdx + 1).padStart(2, "0")} · {f.label}
                      </span>
                      <span className="ml-1 shrink-0 rounded-full bg-[var(--color-surface-2)] px-1.5 text-[10px] text-[var(--color-text)]">
                        {count}
                      </span>
                    </div>

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

                    {f.url.startsWith("blob:") ? null : (
                      <span
                        role="button"
                        aria-label="Remove frame"
                        onClick={(e) => { e.stopPropagation(); removeFrame(f.id); }}
                        className="absolute right-1 top-1 hidden h-6 w-6 cursor-pointer items-center justify-center rounded-full bg-black/60 text-xs text-white group-hover:flex"
                      >
                        ×
                      </span>
                    )}
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
