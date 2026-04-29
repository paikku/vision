"use client";

import {
  type PointerEvent as ReactPointerEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useStore } from "@/lib/store";
import { useStageTransform } from "@/shared/hooks/useStageTransform";
import { useDrawingTool } from "../hooks/useDrawingTool";
import {
  polygonPath,
  shapeAabb,
  shapeContains,
  translateShape,
} from "../shape-utils";
import { TOOLS } from "../tools/registry";
import type { LabelClass, Shape } from "../types";

type FitRect = { left: number; top: number; width: number; height: number };

export function AnnotationStage() {
  const frame = useStore((s) =>
    s.frames.find((f) => f.id === s.activeFrameId) ?? null,
  );
  const taskType = useStore((s) => s.taskType);
  const annotations = useStore((s) => s.annotations);
  const classifications = useStore((s) => s.classifications);
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
  const segmentingIds = useStore((s) => s.segmentingIds);
  const toggleClassification = useStore((s) => s.toggleClassification);

  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [fitState, setFitState] = useState<FitRect | null>(null);
  const [, setHoveredHandleAnnotationId] = useState<string | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [showRectLabels, setShowRectLabels] = useState(true);
  const [showCursorLabel, setShowCursorLabel] = useState(true);
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null);

  const isClassify = taskType === "classify";

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
    disabled: isClassify,
    onBeginDraw: () => selectAnnotation(null),
    onCommit: (imageId, classId, shape) =>
      addAnnotation({ imageId, classId, shape }),
  });

  const dragRef = useRef<
    | null
    | {
        mode: "pan";
        lastClientX: number;
        lastClientY: number;
      }
    | {
        mode: "move";
        annotationId: string;
        startClientX: number;
        startClientY: number;
        hasMoved: boolean;
        startShape: Shape;
      }
    | {
        mode: "resize-rect";
        annotationId: string;
        corner: "tl" | "br";
        startClientX: number;
        startClientY: number;
        hasMoved: boolean;
        startShape: { kind: "rect"; x: number; y: number; w: number; h: number };
      }
    | {
        mode: "resize-vertex";
        annotationId: string;
        ringIndex: number;
        vertexIndex: number;
        startClientX: number;
        startClientY: number;
        hasMoved: boolean;
        startShape: Extract<Shape, { kind: "polygon" }>;
      }
  >(null);

  const DRAG_ACTIVATE_DISTANCE_PX = 2;
  const RECT_MIN_SIZE = 0.0005;

  if (!frame) {
    return (
      <div className="grid h-full place-items-center text-sm text-[var(--color-muted)]">
        Select an image to begin labeling.
      </div>
    );
  }

  const frameAnnotations = annotations.filter((a) => a.imageId === frame.id);
  const frameClassifications = classifications.filter(
    (c) => c.imageId === frame.id,
  );
  const classifiedClassIds = new Set(frameClassifications.map((c) => c.classId));
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
    if (!active || !fitState) return;
    const rawDx = e.clientX - drag.startClientX;
    const rawDy = e.clientY - drag.startClientY;
    if (!drag.hasMoved) {
      if (Math.hypot(rawDx, rawDy) < DRAG_ACTIVATE_DISTANCE_PX) return;
      drag.hasMoved = true;
    }
    const dx = rawDx / (fitState.width * zoom);
    const dy = rawDy / (fitState.height * zoom);

    if (drag.mode === "move") {
      updateAnnotation(active.id, {
        shape: translateShape(drag.startShape, dx, dy),
      });
      return;
    }

    if (drag.mode === "resize-rect") {
      const s = drag.startShape;
      if (drag.corner === "br") {
        const w = Math.max(RECT_MIN_SIZE, Math.min(1 - s.x, s.w + dx));
        const h = Math.max(RECT_MIN_SIZE, Math.min(1 - s.y, s.h + dy));
        updateAnnotation(active.id, {
          shape: { kind: "rect", x: s.x, y: s.y, w, h },
        });
      } else {
        const brX = s.x + s.w;
        const brY = s.y + s.h;
        const nx = Math.max(0, Math.min(brX - RECT_MIN_SIZE, s.x + dx));
        const ny = Math.max(0, Math.min(brY - RECT_MIN_SIZE, s.y + dy));
        updateAnnotation(active.id, {
          shape: { kind: "rect", x: nx, y: ny, w: brX - nx, h: brY - ny },
        });
      }
      return;
    }

    if (drag.mode === "resize-vertex") {
      const s = drag.startShape;
      const ri = drag.ringIndex;
      const vi = drag.vertexIndex;
      const rings = s.rings.map((ring, r) =>
        r !== ri
          ? ring
          : ring.map((p, v) =>
              v !== vi
                ? p
                : {
                    x: Math.max(0, Math.min(1, p.x + dx)),
                    y: Math.max(0, Math.min(1, p.y + dy)),
                  },
            ),
      );
      updateAnnotation(active.id, { shape: { kind: "polygon", rings } });
    }
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
            cursor: isClassify
              ? "default"
              : interactionMode === "draw"
                ? cursor
                : isPanning
                  ? "grabbing"
                  : "grab",
            transformOrigin: "0 0",
            transform: `translate(${px}px, ${py}px) scale(${zoom})`,
          }}
          onPointerDown={
            isClassify
              ? undefined
              : interactionMode === "draw"
                ? handlers.onPointerDown
                : onEditStagePointerDown
          }
          onPointerMove={
            isClassify
              ? undefined
              : interactionMode === "draw"
                ? handlers.onPointerMove
                : onEditStagePointerMove
          }
          onPointerUp={
            isClassify
              ? undefined
              : interactionMode === "draw"
                ? handlers.onPointerUp
                : onEditStagePointerUp
          }
          onPointerCancel={
            isClassify
              ? undefined
              : interactionMode === "draw"
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
          {!isClassify && (
            <svg
              className="absolute inset-0 h-full w-full"
              viewBox="0 0 1 1"
              preserveAspectRatio="none"
              onPointerMove={(e) => {
                if (!stageRef.current) return;
                const b = stageRef.current.getBoundingClientRect();
                const mx = (e.clientX - b.left) / b.width;
                const my = (e.clientY - b.top) / b.height;
                const hits = frameAnnotations.filter((a) =>
                  shapeContains(a.shape, mx, my),
                );
                if (hits.length === 0) { setHoveredAnnotation(null); return; }
                const closest = hits.reduce((best, cur) => {
                  const bb = shapeAabb(best.shape);
                  const cb = shapeAabb(cur.shape);
                  const bd = Math.hypot(mx - (bb.x + bb.w / 2), my - (bb.y + bb.h / 2));
                  const cd = Math.hypot(mx - (cb.x + cb.w / 2), my - (cb.y + cb.h / 2));
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
                    onSelect={isEditMode ? (e) => {
                      e.stopPropagation();
                      selectAnnotation(a.id);
                    } : undefined}
                    onStartMove={isEditMode ? (e) => {
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
          )}

          {!isClassify && isEditMode && selectedAnnotationId && (() => {
            const a = frameAnnotations.find((x) => x.id === selectedAnnotationId);
            if (!a) return null;
            const klass = classes.find((c) => c.id === a.classId);
            if (!klass) return null;
            if (a.shape.kind === "rect") {
              const s = a.shape;
              const startCorner = (corner: "tl" | "br") =>
                (e: ReactPointerEvent<HTMLDivElement>) => {
                  if (a.shape.kind !== "rect") return;
                  e.stopPropagation();
                  e.preventDefault();
                  selectAnnotation(a.id);
                  setHoveredHandleAnnotationId(a.id);
                  dragRef.current = {
                    mode: "resize-rect",
                    annotationId: a.id,
                    corner,
                    startClientX: e.clientX,
                    startClientY: e.clientY,
                    hasMoved: false,
                    startShape: a.shape,
                  };
                  stageRef.current?.setPointerCapture(e.pointerId);
                };
              return (
                <>
                  <Handle x={s.x} y={s.y} color={klass.color} zoom={zoom} onPointerDown={startCorner("tl")} />
                  <Handle x={s.x + s.w} y={s.y + s.h} color={klass.color} zoom={zoom} onPointerDown={startCorner("br")} />
                </>
              );
            }
            if (a.shape.kind === "polygon") {
              const shape = a.shape;
              return shape.rings.flatMap((ring, ri) =>
                ring.map((p, vi) => (
                  <Handle
                    key={`${ri}-${vi}`}
                    x={p.x}
                    y={p.y}
                    color={klass.color}
                    zoom={zoom}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      selectAnnotation(a.id);
                      setHoveredHandleAnnotationId(a.id);
                      dragRef.current = {
                        mode: "resize-vertex",
                        annotationId: a.id,
                        ringIndex: ri,
                        vertexIndex: vi,
                        startClientX: e.clientX,
                        startClientY: e.clientY,
                        hasMoved: false,
                        startShape: shape,
                      };
                      stageRef.current?.setPointerCapture(e.pointerId);
                    }}
                  />
                )),
              );
            }
            return null;
          })()}

          {!isClassify && draftShape?.kind === "polygon" && (() => {
            const cls = classes.find((c) => c.id === activeClassId) ?? classes[0];
            if (!cls) return null;
            const ring = draftShape.rings[0] ?? [];
            const canClose = ring.length >= 3;
            return ring.map((p, i) => {
              const isFirst = i === 0;
              const highlight = isFirst && canClose;
              return (
                <Dot
                  key={i}
                  x={p.x}
                  y={p.y}
                  zoom={zoom}
                  size={highlight ? 11 : 7}
                  fill={highlight ? cls.color : "white"}
                  stroke={cls.color}
                />
              );
            });
          })()}

          {!isClassify && frameAnnotations.map((a) => {
            if (!segmentingIds[a.id]) return null;
            const klass = classes.find((c) => c.id === a.classId);
            const b = shapeAabb(a.shape);
            return (
              <SegmentLoadingOverlay
                key={`seg-${a.id}`}
                aabb={b}
                color={klass?.color ?? "#ffffff"}
                zoom={zoom}
              />
            );
          })}

          {!isClassify && showRectLabels && frameAnnotations.map((a) => {
            const klass = classes.find((c) => c.id === a.classId);
            if (!klass) return null;
            const b = shapeAabb(a.shape);
            return (
              <div
                key={a.id}
                className="pointer-events-none absolute select-none leading-none whitespace-nowrap"
                style={{
                  left: `${(b.x + b.w) * 100}%`,
                  top: `${b.y * 100}%`,
                  transform: `scale(${1 / zoom})`,
                  transformOrigin: "0 0",
                  fontSize: "11px",
                  paddingLeft: "3px",
                  color: klass.color,
                  textShadow: "0 0 4px rgba(0,0,0,0.85)",
                }}
              >
                {klass.name}
              </div>
            );
          })}
        </div>
      )}

      {/* Classify mode: assigned-classes badge bar */}
      {isClassify && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-wrap gap-1 p-3">
          {frameClassifications.map((c) => {
            const klass = classes.find((k) => k.id === c.classId);
            if (!klass) return null;
            return (
              <span
                key={c.id}
                className="pointer-events-auto flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold text-white shadow"
                style={{ background: klass.color }}
              >
                <span className="h-2 w-2 rounded-full bg-white/60" />
                {klass.name}
                <button
                  type="button"
                  onClick={() => toggleClassification(frame.id, c.classId)}
                  className="ml-1 opacity-70 hover:opacity-100"
                  aria-label={`${klass.name} 해제`}
                >
                  ×
                </button>
              </span>
            );
          })}
          {frameClassifications.length === 0 && (
            <span className="rounded bg-black/60 px-2 py-1 text-[11px] text-white/80 backdrop-blur">
              아직 부여된 클래스 없음 · 우측 패널 또는 단축키로 클래스 할당
            </span>
          )}
        </div>
      )}

      {/* Cursor label — fixed so it's unaffected by stageRef transform. Hidden in classify mode. */}
      {!isClassify && showCursorLabel && interactionMode !== "edit" && cursorPos && (() => {
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

      {/* Zoom controls */}
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
        {!isClassify && (
          <>
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
          </>
        )}
      </div>

      {/* Footer status */}
      <div className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-black/55 px-2 py-1 text-[11px] text-white/80 backdrop-blur">
        {frame.width}×{frame.height} ·{" "}
        {isClassify
          ? `${classifiedClassIds.size} classes · classify`
          : `${frameAnnotations.length} labels · ${
              interactionMode === "draw" ? tool.name.toLowerCase() : "edit"
            }`}{" "}
        · scroll to zoom · dblclick to fit
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
  zoom: number;
}) {
  const visualZoom = Math.max(0.25, zoom);
  const fillOpacity = hovered || selected ? "3a" : "22";
  const strokeWidth = (selected ? 2.5 : hovered ? 2.2 : 1.6) / visualZoom;

  if (shape.kind === "polygon") {
    const d = polygonPath(shape.rings, { closed: !draft });
    if (!d) return null;
    return (
      <g
        data-annotation-interactive="true"
        onPointerDown={onStartMove ?? onSelect}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
        style={{ cursor: onStartMove ? "move" : undefined }}
      >
        <path
          d={d}
          fill={draft ? "none" : `${klass.color}${fillOpacity}`}
          fillRule="evenodd"
          stroke={klass.color}
          strokeWidth={strokeWidth}
          strokeLinejoin="round"
          strokeLinecap="round"
          strokeDasharray={draft ? "5 4" : undefined}
          vectorEffect="non-scaling-stroke"
          style={{ cursor: onStartMove ? "move" : onSelect ? "pointer" : undefined }}
        />
        {hovered && !selected && !draft && (
          <path
            d={d}
            fill="none"
            fillRule="evenodd"
            stroke={klass.color}
            strokeWidth={4 / visualZoom}
            strokeOpacity={0.25}
            vectorEffect="non-scaling-stroke"
            style={{ pointerEvents: "none" }}
          />
        )}
      </g>
    );
  }

  if (shape.kind === "rect") {
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
      </g>
    );
  }
  return null;
}

function Handle({
  x,
  y,
  color,
  zoom,
  onPointerDown,
}: {
  x: number;
  y: number;
  color: string;
  zoom: number;
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
}) {
  const visualZoom = Math.max(0.25, zoom);
  const SIZE = 10;
  return (
    <div
      data-annotation-interactive="true"
      onPointerDown={onPointerDown}
      style={{
        position: "absolute",
        left: `${x * 100}%`,
        top: `${y * 100}%`,
        width: SIZE,
        height: SIZE,
        borderRadius: "50%",
        background: "white",
        border: `1.5px solid ${color}`,
        boxShadow: "0 0 0 1px rgba(0,0,0,0.35)",
        transform: `translate(-50%, -50%) scale(${1 / visualZoom})`,
        transformOrigin: "center",
        cursor: "pointer",
        touchAction: "none",
      }}
    />
  );
}

function SegmentLoadingOverlay({
  aabb,
  color,
  zoom,
}: {
  aabb: { x: number; y: number; w: number; h: number };
  color: string;
  zoom: number;
}) {
  const visualZoom = Math.max(0.25, zoom);
  const cx = aabb.x + aabb.w / 2;
  const cy = aabb.y + aabb.h / 2;
  return (
    <div
      className="pointer-events-none absolute"
      style={{
        left: `${cx * 100}%`,
        top: `${cy * 100}%`,
        transform: `translate(-50%, -50%) scale(${1 / visualZoom})`,
        transformOrigin: "center",
      }}
    >
      <div
        className="flex items-center justify-center rounded-full bg-black/55 backdrop-blur-sm"
        style={{ width: 44, height: 44, boxShadow: "0 0 0 1px rgba(255,255,255,0.18)" }}
      >
        <svg
          className="animate-spin"
          width={28}
          height={28}
          viewBox="0 0 50 50"
          aria-hidden
        >
          <circle
            cx={25}
            cy={25}
            r={20}
            fill="none"
            stroke="rgba(255,255,255,0.22)"
            strokeWidth={5}
          />
          <circle
            cx={25}
            cy={25}
            r={20}
            fill="none"
            stroke={color}
            strokeWidth={5}
            strokeLinecap="round"
            strokeDasharray="32 96"
          />
        </svg>
      </div>
    </div>
  );
}

function Dot({
  x,
  y,
  zoom,
  size,
  fill,
  stroke,
}: {
  x: number;
  y: number;
  zoom: number;
  size: number;
  fill: string;
  stroke: string;
}) {
  const visualZoom = Math.max(0.25, zoom);
  return (
    <div
      className="pointer-events-none absolute"
      style={{
        left: `${x * 100}%`,
        top: `${y * 100}%`,
        width: size,
        height: size,
        borderRadius: "50%",
        background: fill,
        border: `1.5px solid ${stroke}`,
        transform: `translate(-50%, -50%) scale(${1 / visualZoom})`,
        transformOrigin: "center",
      }}
    />
  );
}
