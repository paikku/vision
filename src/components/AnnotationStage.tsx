"use client";

import {
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useStore } from "@/lib/store";
import { TOOLS } from "@/lib/tools/registry";
import type { ShapeDraft } from "@/lib/tools/types";
import type { Frame, LabelClass, Point, Shape } from "@/lib/types";

type FitRect = { left: number; top: number; width: number; height: number };

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
  const selectAnnotation = useStore((s) => s.selectAnnotation);
  const removeAnnotation = useStore((s) => s.removeAnnotation);

  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const draftRef = useRef<ShapeDraft | null>(null);
  const pointerIdRef = useRef<number | null>(null);

  const [fit, setFit] = useState<FitRect | null>(null);
  const [draftShape, setDraftShape] = useState<Shape | null>(null);
  const [zoom, setZoom] = useState(1);

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
    setZoom(1);
  }, [frame?.id]);

  const tool = TOOLS[activeToolId];
  const stageCursor = tool.disabled ? "not-allowed" : tool.cursor;

  const toNorm = useCallback((e: ReactPointerEvent | PointerEvent): Point => {
    const stage = stageRef.current;
    if (!stage) return { x: 0, y: 0 };
    const rect = stage.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    return { x: clamp(x), y: clamp(y) };
  }, []);

  const onPointerDown = (e: ReactPointerEvent) => {
    if (!frame || !activeClassId || tool.disabled) return;
    if (e.button !== 0) return;
    e.preventDefault();
    selectAnnotation(null);
    pointerIdRef.current = e.pointerId;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const start = toNorm(e);
    draftRef.current = tool.begin(start);
    setDraftShape(draftRef.current.update(start));
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    if (!draftRef.current) return;
    setDraftShape(draftRef.current.update(toNorm(e)));
  };

  const finishDraft = (e: ReactPointerEvent) => {
    if (!draftRef.current || !frame || !activeClassId) return;
    const end = toNorm(e);
    const shape = draftRef.current.commit(end);
    draftRef.current = null;
    setDraftShape(null);
    if (pointerIdRef.current !== null) {
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(
          pointerIdRef.current,
        );
      } catch {
        /* noop */
      }
      pointerIdRef.current = null;
    }
    if (!shape) return;
    addAnnotation({ frameId: frame.id, classId: activeClassId, shape });
  };


  const onWheel = (e: ReactWheelEvent<HTMLDivElement>) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const next = zoom * (e.deltaY < 0 ? 1.1 : 0.9);
    setZoom(clampZoom(next));
  };

  // Delete key removes selection.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /input|textarea|select/i.test(target.tagName)) return;
      if ((e.key === "Delete" || e.key === "Backspace") && selectedAnnotationId) {
        e.preventDefault();
        removeAnnotation(selectedAnnotationId);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedAnnotationId, removeAnnotation]);

  if (!frame) {
    return (
      <div className="grid h-full place-items-center text-sm text-[var(--color-muted)]">
        Select or capture a frame to begin labeling.
      </div>
    );
  }

  const frameAnnotations = annotations.filter((a) => a.frameId === frame.id);

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
            transform: `scale(${zoom})`,
            transformOrigin: "center center",
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={finishDraft}
          onPointerCancel={finishDraft}
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
                  onSelect={(e) => {
                    e.stopPropagation();
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
          onClick={() => setZoom((z) => clampZoom(z - 0.1))}
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
          onClick={() => setZoom(1)}
          className="rounded px-2 py-1 hover:bg-white/10"
        >
          reset
        </button>
      </div>

      {/* Footer overlay with frame info */}
      <div className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-black/55 px-2 py-1 text-[11px] text-white/80 backdrop-blur">
        {frame.width}×{frame.height} · {frameAnnotations.length} labels · tool:{" "}
        {tool.name.toLowerCase()}
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
  onSelect,
}: {
  shape: Shape;
  klass: LabelClass;
  selected?: boolean;
  hovered?: boolean;
  draft?: boolean;
  onSelect?: (e: ReactPointerEvent) => void;
}) {
  if (shape.kind === "rect") {
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
