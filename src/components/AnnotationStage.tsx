"use client";

import {
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useStore } from "@/lib/store";
import { TOOLS } from "@/lib/tools/registry";
import type { ShapeDraft } from "@/lib/tools/types";
import type { Annotation, Frame, LabelClass, Point, RectShape, Shape } from "@/lib/types";

type FitRect = { left: number; top: number; width: number; height: number };
type InteractionMode = "draw" | "edit";

type DragState =
  | {
      type: "draw";
      draft: ShapeDraft;
      pointerId: number;
    }
  | {
      type: "move";
      pointerId: number;
      annotationId: string;
      startPoint: Point;
      startRect: RectShape;
    }
  | {
      type: "resize";
      pointerId: number;
      annotationId: string;
      startPoint: Point;
      startRect: RectShape;
    }
  | {
      type: "pan";
      pointerId: number;
      startClientX: number;
      startClientY: number;
      startPanX: number;
      startPanY: number;
    };

const RESIZE_HANDLE_SIZE = 0.02;

export function AnnotationStage() {
  const frame = useStore((s) =>
    s.frames.find((f) => f.id === s.activeFrameId) ?? null,
  );
  const annotations = useStore((s) => s.annotations);
  const classes = useStore((s) => s.classes);
  const activeClassId = useStore((s) => s.activeClassId);
  const activeToolId = useStore((s) => s.activeToolId);
  const selectedAnnotationId = useStore((s) => s.selectedAnnotationId);
  const hoveredAnnotationId = useStore((s) => s.hoveredAnnotationId);
  const addAnnotation = useStore((s) => s.addAnnotation);
  const updateAnnotation = useStore((s) => s.updateAnnotation);
  const selectAnnotation = useStore((s) => s.selectAnnotation);
  const removeAnnotation = useStore((s) => s.removeAnnotation);
  const setHoveredAnnotation = useStore((s) => s.setHoveredAnnotation);

  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<DragState | null>(null);

  const [fit, setFit] = useState<FitRect | null>(null);
  const [draftShape, setDraftShape] = useState<Shape | null>(null);
  const [zoom, setZoom] = useState(1);
  const [keepZoom, setKeepZoom] = useState(false);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [interactionMode, setInteractionMode] = useState<InteractionMode>("draw");

  // Compute the largest contain-fit rect for the current frame.
  useLayoutEffect(() => {
    const recompute = () => {
      const c = containerRef.current;
      if (!c || !frame) return setFit(null);
      const cw = c.clientWidth;
      const ch = c.clientHeight;
      const ar = frame.width / frame.height;
      let w = cw;
      let h = cw / ar;
      if (h > ch) {
        h = ch;
        w = ch * ar;
      }
      setFit({
        left: (cw - w) / 2,
        top: (ch - h) / 2,
        width: w,
        height: h,
      });
    };
    recompute();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(recompute);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [frame]);

  useEffect(() => {
    if (!keepZoom) {
      setZoom(1);
      setPan({ x: 0, y: 0 });
      return;
    }
    setPan((prev) => {
      if (zoom <= 1) return { x: 0, y: 0 };
      return prev;
    });
  }, [frame?.id, keepZoom, zoom]);

  const tool = TOOLS[activeToolId];

  const frameAnnotations = useMemo(
    () => (frame ? annotations.filter((a) => a.frameId === frame.id) : []),
    [annotations, frame],
  );

  const toNorm = useCallback((e: ReactPointerEvent | PointerEvent): Point => {
    const stage = stageRef.current;
    if (!stage) return { x: 0, y: 0 };
    const rect = stage.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    return { x: clamp(x), y: clamp(y) };
  }, []);

  const findAnnotationAt = useCallback(
    (point: Point): Annotation | null => {
      for (let i = frameAnnotations.length - 1; i >= 0; i -= 1) {
        const ann = frameAnnotations[i];
        if (ann.shape.kind !== "rect") continue;
        const rect = ann.shape;
        if (
          point.x >= rect.x &&
          point.x <= rect.x + rect.w &&
          point.y >= rect.y &&
          point.y <= rect.y + rect.h
        ) {
          return ann;
        }
      }
      return null;
    },
    [frameAnnotations],
  );

  const hitResizeHandle = useCallback((point: Point, rect: RectShape) => {
    const hx = rect.x + rect.w;
    const hy = rect.y + rect.h;
    return (
      Math.abs(point.x - hx) <= RESIZE_HANDLE_SIZE &&
      Math.abs(point.y - hy) <= RESIZE_HANDLE_SIZE
    );
  }, []);

  const finishDrag = useCallback((target: HTMLElement, pointerId: number) => {
    try {
      target.releasePointerCapture(pointerId);
    } catch {
      /* noop */
    }
    dragStateRef.current = null;
    setDraftShape(null);
  }, []);

  const onPointerDown = (e: ReactPointerEvent) => {
    if (!frame) return;
    if (e.button !== 0) return;

    const stageElement = e.currentTarget as HTMLElement;
    const point = toNorm(e);
    const hit = findAnnotationAt(point);

    if (interactionMode === "edit") {
      e.preventDefault();
      stageElement.setPointerCapture(e.pointerId);

      if (hit && hit.shape.kind === "rect") {
        selectAnnotation(hit.id);
        const isResize = hitResizeHandle(point, hit.shape);
        dragStateRef.current = {
          type: isResize ? "resize" : "move",
          pointerId: e.pointerId,
          annotationId: hit.id,
          startPoint: point,
          startRect: { ...hit.shape },
        };
        return;
      }

      selectAnnotation(null);
      dragStateRef.current = {
        type: "pan",
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startPanX: pan.x,
        startPanY: pan.y,
      };
      return;
    }

    if (!activeClassId || tool.disabled) return;
    e.preventDefault();
    selectAnnotation(null);
    stageElement.setPointerCapture(e.pointerId);
    const draft = tool.begin(point);
    dragStateRef.current = {
      type: "draw",
      draft,
      pointerId: e.pointerId,
    };
    setDraftShape(draft.update(point));
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    const drag = dragStateRef.current;
    const point = toNorm(e);

    if (!drag) {
      if (interactionMode === "edit") {
        const hit = findAnnotationAt(point);
        setHoveredAnnotation(hit?.id ?? null);
      }
      return;
    }

    if (drag.type === "draw") {
      setDraftShape(drag.draft.update(point));
      return;
    }

    if (drag.type === "move") {
      const ann = frameAnnotations.find((a) => a.id === drag.annotationId);
      if (!ann || ann.shape.kind !== "rect") return;
      const dx = point.x - drag.startPoint.x;
      const dy = point.y - drag.startPoint.y;
      const next: RectShape = {
        ...drag.startRect,
        x: clampRectAxis(drag.startRect.x + dx, drag.startRect.w),
        y: clampRectAxis(drag.startRect.y + dy, drag.startRect.h),
      };
      updateAnnotation(drag.annotationId, { shape: next });
      return;
    }

    if (drag.type === "resize") {
      const ann = frameAnnotations.find((a) => a.id === drag.annotationId);
      if (!ann || ann.shape.kind !== "rect") return;
      const dx = point.x - drag.startPoint.x;
      const dy = point.y - drag.startPoint.y;
      const nextW = clampSize(drag.startRect.w + dx, drag.startRect.x);
      const nextH = clampSize(drag.startRect.h + dy, drag.startRect.y);
      const next: RectShape = {
        ...drag.startRect,
        w: nextW,
        h: nextH,
      };
      updateAnnotation(drag.annotationId, { shape: next });
      return;
    }

    if (drag.type === "pan") {
      const dx = e.clientX - drag.startClientX;
      const dy = e.clientY - drag.startClientY;
      setPan({ x: drag.startPanX + dx, y: drag.startPanY + dy });
    }
  };

  const onPointerUp = (e: ReactPointerEvent) => {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;

    if (drag.type === "draw" && frame && activeClassId) {
      const end = toNorm(e);
      const shape = drag.draft.commit(end);
      if (shape) {
        addAnnotation({ frameId: frame.id, classId: activeClassId, shape });
      }
    }

    finishDrag(e.currentTarget as HTMLElement, e.pointerId);
  };

  const onWheel = (e: ReactWheelEvent<HTMLDivElement>) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const next = zoom * (e.deltaY < 0 ? 1.1 : 0.9);
    const nextZoom = clampZoom(next);
    setZoom(nextZoom);
    if (nextZoom <= 1) setPan({ x: 0, y: 0 });
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        (target && /input|textarea|select/i.test(target.tagName)) ||
        target?.isContentEditable
      ) {
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedAnnotationId) {
        e.preventDefault();
        removeAnnotation(selectedAnnotationId);
      }
      if (e.key.toLowerCase() === "c") {
        e.preventDefault();
        setInteractionMode((prev) => (prev === "draw" ? "edit" : "draw"));
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [removeAnnotation, selectedAnnotationId]);

  const stageCursor =
    interactionMode === "draw"
      ? tool.disabled
        ? "not-allowed"
        : tool.cursor
      : "grab";

  if (!frame) {
    return (
      <div className="grid h-full place-items-center text-sm text-[var(--color-muted)]">
        Select or capture a frame to begin labeling.
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-auto bg-checker" onWheel={onWheel}>
      {fit && (
        <div
          ref={stageRef}
          className="absolute select-none"
          style={{
            left: fit.left,
            top: fit.top,
            width: fit.width,
            height: fit.height,
            cursor: stageCursor,
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "center center",
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <FrameImage frame={frame} />
          <svg
            className="absolute inset-0 h-full w-full"
            viewBox="0 0 1 1"
            preserveAspectRatio="none"
          >
            {frameAnnotations.map((a) => {
              const klass = classes.find((c) => c.id === a.classId);
              if (!klass) return null;
              return (
                <ShapeView
                  key={a.id}
                  shape={a.shape}
                  klass={klass}
                  selected={a.id === selectedAnnotationId}
                  hovered={a.id === hoveredAnnotationId}
                  editing={interactionMode === "edit"}
                  onSelect={(evt) => {
                    evt.stopPropagation();
                    selectAnnotation(a.id);
                  }}
                />
              );
            })}
            {draftShape && (
              <ShapeView
                shape={draftShape}
                klass={
                  classes.find((c) => c.id === activeClassId) ?? classes[0]
                }
                draft
              />
            )}
          </svg>
        </div>
      )}

      <div className="absolute right-3 top-3 flex items-center gap-1 rounded-md bg-black/60 p-1 text-xs text-white backdrop-blur">
        <button
          type="button"
          onClick={() => {
            setZoom((z) => {
              const next = clampZoom(z - 0.1);
              if (next <= 1) setPan({ x: 0, y: 0 });
              return next;
            });
          }}
          className="rounded px-2 py-1 hover:bg-white/10"
        >
          -
        </button>
        <span className="w-14 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
        <button
          type="button"
          onClick={() => setZoom((z) => clampZoom(z + 0.1))}
          className="rounded px-2 py-1 hover:bg-white/10"
        >
          +
        </button>
        <button
          type="button"
          onClick={() => {
            setZoom(1);
            setPan({ x: 0, y: 0 });
          }}
          className="rounded px-2 py-1 hover:bg-white/10"
        >
          fit
        </button>
        <label className="ml-1 flex items-center gap-1 rounded px-1 py-1 hover:bg-white/10">
          <input
            type="checkbox"
            checked={keepZoom}
            onChange={(e) => {
              const checked = e.target.checked;
              setKeepZoom(checked);
              if (!checked) {
                setZoom(1);
                setPan({ x: 0, y: 0 });
              }
            }}
            className="accent-[var(--color-accent)]"
          />
          keep zoom
        </label>
      </div>

      <div className="absolute left-3 top-3 flex items-center gap-2 rounded-md bg-black/60 px-2 py-1 text-xs text-white backdrop-blur">
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={interactionMode === "edit"}
            onChange={(e) =>
              setInteractionMode(e.target.checked ? "edit" : "draw")
            }
            className="accent-[var(--color-accent)]"
          />
          edit mode (C)
        </label>
      </div>

      <div className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-black/55 px-2 py-1 text-[11px] text-white/80 backdrop-blur">
        {frame.width}×{frame.height} · {frameAnnotations.length} labels · mode: {interactionMode}
      </div>
    </div>
  );
}

function FrameImage({ frame }: { frame: Frame }) {
  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={frame.url}
      alt={frame.label}
      draggable={false}
      className="absolute inset-0 h-full w-full object-fill"
    />
  );
}

function ShapeView({
  shape,
  klass,
  selected,
  hovered,
  draft,
  editing,
  onSelect,
}: {
  shape: Shape;
  klass: LabelClass;
  selected?: boolean;
  hovered?: boolean;
  draft?: boolean;
  editing?: boolean;
  onSelect?: (e: ReactPointerEvent) => void;
}) {
  if (shape.kind === "rect") {
    const handleSize = Math.max(0.008, Math.min(shape.w, shape.h) * 0.15);
    const handleX = shape.x + shape.w - handleSize;
    const handleY = shape.y + shape.h - handleSize;

    return (
      <g onPointerDown={onSelect}>
        <rect
          x={shape.x}
          y={shape.y}
          width={shape.w}
          height={shape.h}
          fill={`${klass.color}22`}
          stroke={klass.color}
          strokeWidth={selected ? 2.5 : hovered ? 2.2 : 1.6}
          strokeDasharray={draft ? "5 4" : undefined}
          vectorEffect="non-scaling-stroke"
          opacity={hovered ? 1 : 0.95}
          filter={hovered ? "drop-shadow(0 0 4px rgba(255,255,255,0.85))" : undefined}
          style={{ cursor: onSelect ? "pointer" : undefined }}
        />
        {editing && !draft && (
          <rect
            x={handleX}
            y={handleY}
            width={handleSize}
            height={handleSize}
            fill={klass.color}
            stroke="white"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
            opacity={0.95}
          />
        )}
      </g>
    );
  }
  return null;
}

function clamp(v: number) {
  return Math.max(0, Math.min(1, v));
}

function clampZoom(v: number) {
  return Math.max(1, Math.min(4, v));
}

function clampRectAxis(pos: number, size: number) {
  return Math.max(0, Math.min(1 - size, pos));
}

function clampSize(size: number, origin: number) {
  const min = 0.005;
  const max = 1 - origin;
  return Math.max(min, Math.min(max, size));
}
