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
  const setHoveredAnnotation = useStore((s) => s.setHoveredAnnotation);
  const interactionMode = useStore((s) => s.interactionMode);
  const setInteractionMode = useStore((s) => s.setInteractionMode);
  const keepZoomOnFrameChange = useStore((s) => s.keepZoomOnFrameChange);
  const setKeepZoomOnFrameChange = useStore((s) => s.setKeepZoomOnFrameChange);

  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [fitState, setFitState] = useState<FitRect | null>(null);
  const [hoveredHandleAnnotationId, setHoveredHandleAnnotationId] = useState<string | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [showRectLabels, setShowRectLabels] = useState(true);
  const [showCursorLabel, setShowCursorLabel] = useState(true);
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null);

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
    interactionMode,
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

  // Move: only clamp position, never touch size.
  const clampMove = useCallback((x: number, y: number, w: number, h: number) => ({
    x: Math.max(0, Math.min(1 - w, x)),
    y: Math.max(0, Math.min(1 - h, y)),
    w,
    h,
  }), []);

  // Resize: enforce minimum size, keep top-left fixed.
  const clampResize = useCallback((x: number, y: number, w: number, h: number) => {
    const minSize = 0.0005;
    const nextW = Math.max(minSize, Math.min(1 - x, w));
    const nextH = Math.max(minSize, Math.min(1 - y, h));
    return { x, y, w: nextW, h: nextH };
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
    const target = e.target as HTMLElement | SVGElement;
    if (target.closest('[data-annotation-interactive="true"]')) return;
    e.preventDefault();
    selectAnnotation(null);
    dragRef.current = {
      mode: "pan",
      lastClientX: e.clientX,
      lastClientY: e.clientY,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsPanning(true);
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
        ? clampMove(start.x + dx, start.y + dy, start.w, start.h)
        : clampResize(start.x, start.y, start.w + dx, start.h + dy);
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
    setIsPanning(false);
  };

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden bg-checker"
      onDoubleClick={resetZoom}
      onMouseMove={(e) => setCursorPos({ x: e.clientX, y: e.clientY })}
      onMouseLeave={() => setCursorPos(null)}
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
            cursor: interactionMode === "draw" ? cursor : isPanning ? "grabbing" : "grab",
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
            onPointerMove={(e) => {
              if (!stageRef.current) return;
              const b = stageRef.current.getBoundingClientRect();
              const mx = (e.clientX - b.left) / b.width;
              const my = (e.clientY - b.top) / b.height;
              const hits = frameAnnotations.filter((a) => {
                if (a.shape.kind !== "rect") return false;
                const { x, y, w, h } = a.shape;
                return mx >= x && mx <= x + w && my >= y && my <= y + h;
              });
              if (hits.length === 0) { setHoveredAnnotation(null); return; }
              const closest = hits.reduce((best, cur) => {
                const bs = best.shape as { x: number; y: number; w: number; h: number };
                const cs = cur.shape as { x: number; y: number; w: number; h: number };
                const bd = Math.hypot(mx - (bs.x + bs.w / 2), my - (bs.y + bs.h / 2));
                const cd = Math.hypot(mx - (cs.x + cs.w / 2), my - (cs.y + cs.h / 2));
                return cd < bd ? cur : best;
              });
              setHoveredAnnotation(closest.id);
            }}
            onPointerLeave={() => setHoveredAnnotation(null)}
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
                  zoom={zoom}
                  onSelect={(e) => {
                    if (interactionMode !== "edit") return;
                    e.stopPropagation();
                    selectAnnotation(a.id);
                  }}
                  showHandle={isEditMode && a.id === selectedAnnotationId}
                  onStartMove={isEditMode ? (e) => {
                    if (a.shape.kind !== "rect") return;
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
                  } : undefined}
                  onStartResize={isEditMode ? (e) => {
                    if (a.shape.kind !== "rect") return;
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
                  } : undefined}
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

          {/* Rect label overlays — outside box, top-right corner, no background */}
          {showRectLabels && frameAnnotations.map((a) => {
            if (a.shape.kind !== "rect") return null;
            const klass = classes.find((c) => c.id === a.classId);
            if (!klass) return null;
            const s = a.shape;
            const fs = Math.max(4, 11 / zoom);
            return (
              <div
                key={a.id}
                className="pointer-events-none absolute select-none leading-none whitespace-nowrap"
                style={{
                  left: `${(s.x + s.w) * 100}%`,
                  top: `${s.y * 100}%`,
                  paddingLeft: `${3 / zoom}px`,
                  fontSize: `${fs}px`,
                  color: klass.color,
                  textShadow: `0 0 ${4 / zoom}px rgba(0,0,0,0.85)`,
                }}
              >
                {klass.name}
              </div>
            );
          })}
        </div>
      )}

      {/* Cursor label — fixed so it's unaffected by stageRef transform */}
      {showCursorLabel && interactionMode !== "edit" && cursorPos && (() => {
        const cls = classes.find((c) => c.id === activeClassId);
        if (!cls) return null;
        return (
          <div
            className="pointer-events-none fixed z-50 select-none rounded px-2 py-0.5 text-xs font-semibold text-white shadow-md"
            style={{ left: cursorPos.x + 14, top: cursorPos.y + 14, background: cls.color }}
          >
            {cls.name}
          </div>
        );
      })()}

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
        <label className="ml-1 flex items-center gap-1 rounded px-2 py-1 hover:bg-white/10">
          <input
            type="checkbox"
            checked={showRectLabels}
            onChange={(e) => setShowRectLabels(e.target.checked)}
          />
          라벨
        </label>
        <label className="ml-1 flex items-center gap-1 rounded px-2 py-1 hover:bg-white/10">
          <input
            type="checkbox"
            checked={showCursorLabel}
            onChange={(e) => setShowCursorLabel(e.target.checked)}
          />
          커서라벨
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
  onPointerEnter,
  onPointerLeave,
  onStartMove,
  onStartResize,
  showHandle,
  zoom,
}: {
  shape: Shape;
  klass: LabelClass;
  selected?: boolean;
  hovered?: boolean;
  draft?: boolean;
  onSelect?: (e: ReactPointerEvent) => void;
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
  onStartMove?: (e: ReactPointerEvent<SVGGElement>) => void;
  onStartResize?: (e: ReactPointerEvent<SVGRectElement>) => void;
  showHandle?: boolean;
  zoom: number;
}) {
  if (shape.kind === "rect") {
    const visualZoom = Math.max(0.25, zoom);
    const fillOpacity = hovered || selected ? "3a" : "22";
    const strokeWidth = (selected ? 2.5 : hovered ? 2.2 : 1.6) / visualZoom;
    // Hit area: ~20 screen-pixels regardless of zoom, capped to 45% of shape.
    // 0.025/zoom converts to a constant visual pixel size (assuming ~800px stage).
    const hitNorm = Math.min(0.06, 0.055 / zoom);
    const hitWidth = Math.min(shape.w * 0.45, hitNorm);
    const hitHeight = Math.min(shape.h * 0.45, hitNorm);
    return (
      <g
        data-annotation-interactive="true"
        onPointerDown={onStartMove ?? onSelect}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
        style={{ cursor: onStartMove ? "move" : undefined }}
      >
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
        {/* Resize hit area (no visual, cursor only) */}
        {showHandle && !draft && (
          <rect
            x={shape.x + shape.w - hitWidth}
            y={shape.y + shape.h - hitHeight}
            width={hitWidth}
            height={hitHeight}
            fill="transparent"
            onPointerDown={onStartResize}
            data-annotation-interactive="true"
            style={{ cursor: "nwse-resize" }}
          />
        )}
      </g>
    );
  }
  return null;
}

// Retained for possible future use
function _getContrastingHandleColor(hexColor: string) {
  const hex = hexColor.replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return "#ffffff";
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  return luminance > 150 ? "#111111" : "#ffffff";
}
