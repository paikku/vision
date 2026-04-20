"use client";

import {
  type PointerEvent as ReactPointerEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useStore } from "@/lib/store";
import { TOOLS } from "@/lib/tools/registry";
import { useDrawingTool } from "@/hooks/useDrawingTool";
import { useStageTransform } from "@/hooks/useStageTransform";
import type { LabelClass, Shape } from "@/lib/types";

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

  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [fitState, setFitState] = useState<FitRect | null>(null);

  // Contain-fit layout, recomputed on resize.
  useLayoutEffect(() => {
    const recompute = () => {
      const c = containerRef.current;
      if (!c || !frame) return setFitState(null);
      const cw = c.clientWidth;
      const ch = c.clientHeight;
      const ar = frame.width / frame.height;
      let w = cw;
      let h = cw / ar;
      if (h > ch) { h = ch; w = ch * ar; }
      const next: FitRect = {
        left: (cw - w) / 2,
        top: (ch - h) / 2,
        width: w,
        height: h,
      };
      setFitState(next);
      setFit(next);
    };
    recompute();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(recompute);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame?.id, frame?.width, frame?.height]);

  const { transform, setFit, zoomFromCenter, reset: resetZoom } =
    useStageTransform(containerRef, frame?.id);

  const { draftShape, cursor, handlers } = useDrawingTool({
    stageRef,
    frame,
    activeClassId,
    activeToolId,
    onBeginDraw: () => selectAnnotation(null),
    onCommit: (frameId, classId, shape) =>
      addAnnotation({ frameId, classId, shape }),
  });

  if (!frame) {
    return (
      <div className="grid h-full place-items-center text-sm text-[var(--color-muted)]">
        Select or capture a frame to begin labeling.
      </div>
    );
  }

  const frameAnnotations = annotations.filter((a) => a.frameId === frame.id);
  const { zoom, px, py } = transform;
  const tool = TOOLS[activeToolId];

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden bg-checker"
      onDoubleClick={resetZoom}
    >
      {fitState && (
        <div
          ref={stageRef}
          className="absolute select-none"
          style={{
            left: fitState.left,
            top: fitState.top,
            width: fitState.width,
            height: fitState.height,
            cursor,
            transformOrigin: "0 0",
            transform: `translate(${px}px, ${py}px) scale(${zoom})`,
          }}
          {...handlers}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={frame.url}
            alt={frame.label}
            draggable={false}
            className="absolute inset-0 h-full w-full object-fill"
          />
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

      {/* Zoom controls — double-click stage to reset */}
      <div className="absolute right-3 top-3 flex items-center gap-1 rounded-md bg-black/60 p-1 text-xs text-white backdrop-blur">
        <button
          type="button"
          onClick={() => zoomFromCenter(1 / 1.2)}
          className="rounded px-2 py-1 hover:bg-white/10"
        >
          −
        </button>
        <span className="w-14 text-center tabular-nums">
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          onClick={() => zoomFromCenter(1.2)}
          className="rounded px-2 py-1 hover:bg-white/10"
        >
          +
        </button>
        <button
          type="button"
          onClick={resetZoom}
          className="rounded px-2 py-1 hover:bg-white/10"
        >
          fit
        </button>
      </div>

      {/* Footer status */}
      <div className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-black/55 px-2 py-1 text-[11px] text-white/80 backdrop-blur">
        {frame.width}×{frame.height} · {frameAnnotations.length} labels ·{" "}
        {tool.name.toLowerCase()} · scroll to zoom · dblclick to fit
      </div>
    </div>
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
    const fillOpacity = hovered || selected ? "44" : "22";
    const strokeWidth = selected ? 2.5 : hovered ? 2.2 : 1.6;
    return (
      <g onPointerDown={onSelect}>
        <rect
          x={shape.x}
          y={shape.y}
          width={shape.w}
          height={shape.h}
          fill={`${klass.color}${fillOpacity}`}
          stroke={klass.color}
          strokeWidth={strokeWidth}
          strokeDasharray={draft ? "5 4" : undefined}
          vectorEffect="non-scaling-stroke"
          style={{ cursor: onSelect ? "pointer" : undefined }}
        />
        {/* Outer glow ring when hovered from the panel */}
        {hovered && !draft && (
          <rect
            x={shape.x}
            y={shape.y}
            width={shape.w}
            height={shape.h}
            fill="none"
            stroke={klass.color}
            strokeWidth={5}
            strokeOpacity={0.25}
            vectorEffect="non-scaling-stroke"
            style={{ pointerEvents: "none" }}
          />
        )}
      </g>
    );
  }
  return null;
}
