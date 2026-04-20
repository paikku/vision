"use client";

import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
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
  const updateAnnotation = useStore((s) => s.updateAnnotation);
  const interactionMode = useStore((s) => s.interactionMode);
  const setInteractionMode = useStore((s) => s.setInteractionMode);
  const keepZoomOnFrameChange = useStore((s) => s.keepZoomOnFrameChange);
  const setKeepZoomOnFrameChange = useStore((s) => s.setKeepZoomOnFrameChange);

  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [fitState, setFitState] = useState<FitRect | null>(null);
  const [hoveredHandleAnnotationId, setHoveredHandleAnnotationId] = useState<string | null>(null);

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

  const { transform, setFit, zoomFromCenter, reset: resetZoom, panBy } =
    useStageTransform(containerRef, {
      resetKey: frame?.id,
      preserveOnReset: keepZoomOnFrameChange,
    });

  const { draftShape, cursor, handlers } = useDrawingTool({
    stageRef,
    frame,
    activeClassId,
    activeToolId,
    onBeginDraw: () => selectAnnotation(null),
    onCommit: (frameId, classId, shape) =>
      addAnnotation({ frameId, classId, shape }),
  });

  const dragRef = useRef<
    | null
    | {
        mode: "pan";
        lastClientX: number;
        lastClientY: number;
      }
    | {
        mode: "move" | "resize";
        annotationId: string;
        startClientX: number;
        startClientY: number;
        hasMoved: boolean;
        startShape: { x: number; y: number; w: number; h: number };
      }
  >(null);

  const DRAG_ACTIVATE_DISTANCE_PX = 2;

  const clampRect = useCallback((x: number, y: number, w: number, h: number) => {
    const minSize = 0.005;
    const nextW = Math.max(minSize, Math.min(1, w));
    const nextH = Math.max(minSize, Math.min(1, h));
    return {
      x: Math.max(0, Math.min(1 - nextW, x)),
      y: Math.max(0, Math.min(1 - nextH, y)),
      w: nextW,
      h: nextH,
    };
  }, []);

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
  const isEditMode = interactionMode === "edit";

  const onEditStagePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (interactionMode !== "edit" || e.button !== 0) return;
    if (e.target !== e.currentTarget) return;
    e.preventDefault();
    selectAnnotation(null);
    dragRef.current = {
      mode: "pan",
      lastClientX: e.clientX,
      lastClientY: e.clientY,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onEditStagePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (interactionMode !== "edit" || !drag) return;
    if (drag.mode === "pan") {
      const dx = e.clientX - drag.lastClientX;
      const dy = e.clientY - drag.lastClientY;
      drag.lastClientX = e.clientX;
      drag.lastClientY = e.clientY;
      panBy(dx, dy);
      return;
    }

    const active = frameAnnotations.find((a) => a.id === drag.annotationId);
    if (!active || active.shape.kind !== "rect" || !fitState) return;
    const rawDx = e.clientX - drag.startClientX;
    const rawDy = e.clientY - drag.startClientY;
    if (!drag.hasMoved) {
      if (Math.hypot(rawDx, rawDy) < DRAG_ACTIVATE_DISTANCE_PX) return;
      drag.hasMoved = true;
    }
    const dx = rawDx / (fitState.width * zoom);
    const dy = rawDy / (fitState.height * zoom);
    const start = drag.startShape;
    const next =
      drag.mode === "move"
        ? clampRect(start.x + dx, start.y + dy, start.w, start.h)
        : clampRect(start.x, start.y, start.w + dx, start.h + dy);
    updateAnnotation(active.id, { shape: { kind: "rect", ...next } });
  };

  const onEditStagePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // noop
      }
    }
    dragRef.current = null;
    setHoveredHandleAnnotationId(null);
  };

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
            cursor: interactionMode === "draw" ? cursor : "default",
            transformOrigin: "0 0",
            transform: `translate(${px}px, ${py}px) scale(${zoom})`,
          }}
          onPointerDown={
            interactionMode === "draw"
              ? handlers.onPointerDown
              : onEditStagePointerDown
          }
          onPointerMove={
            interactionMode === "draw"
              ? handlers.onPointerMove
              : onEditStagePointerMove
          }
          onPointerUp={
            interactionMode === "draw" ? handlers.onPointerUp : onEditStagePointerUp
          }
          onPointerCancel={
            interactionMode === "draw"
              ? handlers.onPointerCancel
              : onEditStagePointerUp
          }
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
                  hovered={isEditMode && a.id === hoveredAnnotationId}
                  zoom={zoom}
                  onSelect={(e) => {
                    if (interactionMode !== "edit") return;
                    e.stopPropagation();
                    selectAnnotation(a.id);
                  }}
                  showHandle={isEditMode && a.id === selectedAnnotationId}
                  resizing={a.id === hoveredHandleAnnotationId}
                  onStartMove={(e) => {
                    if (interactionMode !== "edit" || a.shape.kind !== "rect") return;
                    e.stopPropagation();
                    e.preventDefault();
                    selectAnnotation(a.id);
                    dragRef.current = {
                      mode: "move",
                      annotationId: a.id,
                      startClientX: e.clientX,
                      startClientY: e.clientY,
                      hasMoved: false,
                      startShape: a.shape,
                    };
                    stageRef.current?.setPointerCapture(e.pointerId);
                  }}
                  onStartResize={(e) => {
                    if (interactionMode !== "edit" || a.shape.kind !== "rect") return;
                    e.stopPropagation();
                    e.preventDefault();
                    selectAnnotation(a.id);
                    setHoveredHandleAnnotationId(a.id);
                    dragRef.current = {
                      mode: "resize",
                      annotationId: a.id,
                      startClientX: e.clientX,
                      startClientY: e.clientY,
                      hasMoved: false,
                      startShape: a.shape,
                    };
                    stageRef.current?.setPointerCapture(e.pointerId);
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
                zoom={zoom}
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
        <label className="ml-1 flex items-center gap-1 rounded px-2 py-1 hover:bg-white/10">
          <input
            type="checkbox"
            checked={keepZoomOnFrameChange}
            onChange={(e) => {
              const checked = e.target.checked;
              setKeepZoomOnFrameChange(checked);
              if (!checked) resetZoom();
            }}
          />
          zoom 유지
        </label>
        <label className="ml-1 flex items-center gap-1 rounded px-2 py-1 hover:bg-white/10">
          <input
            type="checkbox"
            checked={interactionMode === "edit"}
            onChange={(e) => setInteractionMode(e.target.checked ? "edit" : "draw")}
          />
          edit (C)
        </label>
      </div>

      {/* Footer status */}
      <div className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-black/55 px-2 py-1 text-[11px] text-white/80 backdrop-blur">
        {frame.width}×{frame.height} · {frameAnnotations.length} labels ·{" "}
        {interactionMode === "draw" ? tool.name.toLowerCase() : "edit"} · scroll to zoom · dblclick to fit
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
  onStartMove,
  onStartResize,
  showHandle,
  resizing,
}: {
  shape: Shape;
  klass: LabelClass;
  selected?: boolean;
  hovered?: boolean;
  draft?: boolean;
  onSelect?: (e: ReactPointerEvent) => void;
  onStartMove?: (e: ReactPointerEvent<SVGGElement>) => void;
  onStartResize?: (e: ReactPointerEvent<SVGRectElement>) => void;
  showHandle?: boolean;
  resizing?: boolean;
  zoom: number;
}) {
  if (shape.kind === "rect") {
    const visualZoom = Math.max(0.25, zoom);
    const fillOpacity = hovered || selected ? "3a" : "22";
    const strokeWidth = (selected ? 2.5 : hovered ? 2.2 : 1.6) / visualZoom;
    const handleSize = 0.02 / Math.sqrt(visualZoom);
    return (
      <g onPointerDown={onStartMove ?? onSelect} style={{ cursor: onStartMove ? "move" : undefined }}>
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
          style={{ cursor: onStartMove ? "move" : onSelect ? "pointer" : undefined }}
        />
        {/* Outer glow ring when hovered from the panel */}
        {hovered && !selected && !draft && (
          <rect
            x={shape.x}
            y={shape.y}
            width={shape.w}
            height={shape.h}
            fill="none"
            stroke={klass.color}
            strokeWidth={4 / visualZoom}
            strokeOpacity={0.25}
            vectorEffect="non-scaling-stroke"
            style={{ pointerEvents: "none" }}
          />
        )}
        {showHandle && !draft && (
          <rect
            x={shape.x + shape.w - handleSize}
            y={shape.y + shape.h - handleSize}
            width={handleSize}
            height={handleSize}
            fill={klass.color}
            stroke="white"
            strokeWidth={1.5 / visualZoom}
            vectorEffect="non-scaling-stroke"
            onPointerDown={onStartResize}
            style={{ cursor: resizing ? "nwse-resize" : "nwse-resize" }}
          />
        )}
      </g>
    );
  }
  return null;
}
