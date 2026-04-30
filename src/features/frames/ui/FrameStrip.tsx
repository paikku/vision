"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { selectVisibleFrames, useStore } from "@/lib/store";
import type { Annotation, LabelClass } from "@/features/annotations/types";
import type { FrameSortOrder } from "../slice";

// Virtualization constants. Item height is measured at runtime from the first
// rendered row so we adapt to any layout tweaks — these are only the initial
// estimate and the overscan buffer.
const DEFAULT_ITEM_HEIGHT = 180;
const OVERSCAN = 6;
const ITEM_GAP = 6;
const LIST_PADDING = 8;

/**
 * Left-rail thumbnail list. Width is fixed (`w-72`, matching LabelPanel) so
 * the workspace stays visually balanced — the strip is a navigation overview,
 * not a primary drawing surface.
 */
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

  // Annotations bucketed by frame so the overlay/badge can iterate in O(1).
  const annotationsByFrame = useMemo(() => {
    const map = new Map<string, Annotation[]>();
    for (const a of annotations) {
      const arr = map.get(a.frameId) ?? [];
      arr.push(a);
      map.set(a.frameId, arr);
    }
    return map;
  }, [annotations]);

  const originalIndex = useMemo(() => {
    const map = new Map<string, number>();
    frames.forEach((f, i) => map.set(f.id, i));
    return map;
  }, [frames]);

  const classById = useMemo(() => {
    const map = new Map<string, LabelClass>();
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
        unlabeledOnly,
        rangeFilterEnabled,
        frameRange,
      }),
    [frames, annotations, exceptedFrameIds, sort, unlabeledOnly, rangeFilterEnabled, frameRange],
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
      <div className="w-72 shrink-0 border-r border-[var(--color-line)] px-3 py-3 text-center text-xs text-[var(--color-muted)]">
        프레임 없음
      </div>
    );
  }

  return (
    <div className="flex w-72 shrink-0 flex-col border-r border-[var(--color-line)] bg-[var(--color-surface)]">
      {/* Sort + filter controls */}
      <div className="flex shrink-0 items-center gap-1 border-b border-[var(--color-line)] px-2 py-1.5 text-[11px]">
        <span className="text-[var(--color-muted)]">정렬</span>
        {(["added", "time"] as FrameSortOrder[]).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSort(s)}
            className={[
              "rounded px-2 py-0.5 transition",
              sort === s
                ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                : "text-[var(--color-muted)] hover:text-[var(--color-text)]",
            ].join(" ")}
            title={s === "added" ? "추가순" : "시간순"}
          >
            {s === "added" ? "추가" : "시간"}
          </button>
        ))}
        <span className="mx-1 h-3 w-px bg-[var(--color-line)]" />
        <button
          type="button"
          onClick={() => setUnlabeledOnly(!unlabeledOnly)}
          className={[
            "rounded px-2 py-0.5 transition",
            unlabeledOnly
              ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
              : "text-[var(--color-muted)] hover:text-[var(--color-text)]",
          ].join(" ")}
          title="미라벨만"
        >
          미라벨
        </button>
        <button
          type="button"
          onClick={() => setRangeFilterEnabled(!rangeFilterEnabled)}
          disabled={!frameRange}
          title={frameRange ? "타임라인 범위 내 프레임만 표시" : "타임라인에서 범위를 먼저 설정하세요"}
          className={[
            "rounded px-2 py-0.5 transition disabled:opacity-40",
            rangeFilterEnabled && frameRange
              ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
              : "text-[var(--color-muted)] hover:text-[var(--color-text)]",
          ].join(" ")}
        >
          범위
        </button>
      </div>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto"
      >
        {filtered.length === 0 ? (
          <p className="py-3 text-center text-[10px] text-[var(--color-muted)]">
            결과 없음
          </p>
        ) : (
          <div
            role="list"
            className="relative px-2"
            style={{ height: totalHeight + LIST_PADDING * 2 }}
          >
            {visibleSlice.map((f, i) => {
              const absIdx = startIdx + i;
              const active = f.id === activeFrameId;
              const frameAnns = annotationsByFrame.get(f.id) ?? [];
              const count = frameAnns.length;
              const excepted = !!exceptedFrameIds[f.id];
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
                        ? "border-[var(--color-accent)] ring-1 ring-[var(--color-accent)]/40"
                        : "border-[var(--color-line)] hover:border-[var(--color-muted)]",
                    ].join(" ")}
                  >
                    <div className="relative aspect-video w-full bg-black">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={f.url}
                        alt={f.label}
                        loading="lazy"
                        decoding="async"
                        className="absolute inset-0 h-full w-full object-contain"
                      />
                      <ShapeOverlay annotations={frameAnns} classById={classById} />
                    </div>

                    {/* Footer: index · filename · (annotation count or
                        exception toggle). Wider strip allows the filename
                        and (optional) timestamp to live next to the index. */}
                    <div
                      title={f.label}
                      className="flex items-center gap-1.5 bg-[var(--color-surface)] px-2 py-1 text-[10px] text-[var(--color-muted)]"
                    >
                      <span className="tabular-nums">#{originalIdx + 1}</span>
                      <span className="flex-1 truncate text-[var(--color-text)]">
                        {f.label}
                      </span>
                      {typeof f.timestamp === "number" && (
                        <span className="tabular-nums text-[var(--color-muted)]">
                          {f.timestamp.toFixed(2)}s
                        </span>
                      )}
                      {count > 0 && (
                        <span className="rounded-full bg-[var(--color-surface-2)] px-1.5 text-[10px] text-[var(--color-text)]">
                          {count}
                        </span>
                      )}
                      {count === 0 && (
                        <span
                          role="button"
                          aria-label={excepted ? "제외 해제" : "라벨 제외"}
                          title={excepted ? "미라벨 필터에서 제외 해제" : "미라벨 필터에서 제외"}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleFrameException(f.id);
                          }}
                          className={[
                            "rounded-full px-1.5 text-[10px] cursor-pointer transition",
                            excepted
                              ? "bg-[var(--color-accent)]/80 text-white"
                              : "invisible group-hover:visible bg-[var(--color-surface-2)] text-[var(--color-muted)]",
                          ].join(" ")}
                        >
                          제외
                        </span>
                      )}
                    </div>

                    {/* Remove button */}
                    <span
                      role="button"
                      aria-label="Remove frame"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeFrame(f.id);
                      }}
                      className="absolute right-0.5 top-0.5 hidden h-4 w-4 cursor-pointer items-center justify-center rounded-full bg-black/70 text-[10px] leading-none text-white group-hover:flex"
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

/**
 * Render rect/polygon outlines in normalized 0..1 space directly on top of
 * the thumbnail. Classify-kind annotations have no shape — they show as a
 * colored class-color border instead, drawn as a 1-pixel rectangle along
 * the thumbnail edges.
 */
function ShapeOverlay({
  annotations,
  classById,
}: {
  annotations: Annotation[];
  classById: Map<string, LabelClass>;
}) {
  if (annotations.length === 0) return null;
  const classifyAnn = annotations.find((a) => a.kind === "classify");
  const classifyClass = classifyAnn
    ? classById.get(classifyAnn.classId)
    : null;
  return (
    <>
      {classifyClass && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-sm"
          style={{ boxShadow: `inset 0 0 0 2px ${classifyClass.color}` }}
        />
      )}
      <svg
        aria-hidden
        viewBox="0 0 1 1"
        preserveAspectRatio="none"
        className="pointer-events-none absolute inset-0 h-full w-full"
      >
        {annotations.map((a) => {
          if (a.kind === "classify" || !a.shape) return null;
          const klass = classById.get(a.classId);
          const color = klass?.color ?? "#5b8cff";
          if (a.shape.kind === "rect") {
            return (
              <rect
                key={a.id}
                x={a.shape.x}
                y={a.shape.y}
                width={a.shape.w}
                height={a.shape.h}
                fill={color}
                fillOpacity={0.18}
                stroke={color}
                strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
              />
            );
          }
          return a.shape.rings.map((ring, ri) => {
            const points = ring.map((p) => `${p.x},${p.y}`).join(" ");
            return (
              <polygon
                key={`${a.id}-${ri}`}
                points={points}
                fill={color}
                fillOpacity={0.18}
                stroke={color}
                strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
              />
            );
          });
        })}
      </svg>
    </>
  );
}
