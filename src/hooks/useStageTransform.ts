"use client";

import { type RefObject, useCallback, useEffect, useRef, useState } from "react";

export type StageTransform = {
  zoom: number;
  px: number;
  py: number;
};

type FitRect = { left: number; top: number; width: number; height: number };

const INITIAL: StageTransform = { zoom: 1, px: 0, py: 0 };
// Minimum zoom is 1 (fit-to-container). Cannot zoom out beyond the base fit level.
const MIN_ZOOM = 1;
const MAX_ZOOM = 20;
const ZOOM_SPEED = 0.002; // per pixel of deltaY
const PINCH_SPEED = 0.05; // when ctrlKey (pinch gesture)

/**
 * Manages zoom + pan for the annotation stage.
 *
 * - Mouse wheel: zoom centered on cursor
 * - Double-click on container: reset to fit
 * - resetKey: any change resets to fit (use the active frame id)
 *
 * Apply to the stage div:
 *   style={{ transformOrigin: "0 0", transform: `translate(${px}px, ${py}px) scale(${zoom})` }}
 *
 * The stage div's getBoundingClientRect() already accounts for the transform,
 * so toNorm in useDrawingTool needs no adjustment.
 */
export function useStageTransform(
  containerRef: RefObject<HTMLDivElement | null>,
  options?: {
    resetKey?: unknown;
    preserveOnReset?: boolean;
  },
) {
  const [transform, setTransform] = useState<StageTransform>(INITIAL);
  const fitRef = useRef<FitRect | null>(null);

  // Sync fit rect from AnnotationStage so wheel handler can use it.
  const setFit = useCallback((fit: FitRect | null) => {
    fitRef.current = fit;
  }, []);

  // Reset to fit when active frame changes.
  useEffect(() => {
    if (options?.preserveOnReset) return;
    setTransform(INITIAL);
  }, [options?.preserveOnReset, options?.resetKey]);

  // Compute new transform that keeps a given container-space point stationary.
  const zoomAt = useCallback(
    (cursorX: number, cursorY: number, factor: number) => {
      setTransform((prev) => {
        const fit = fitRef.current;
        if (!fit) return prev;
        const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, prev.zoom * factor));
        // When clamped to fit level, snap back to center to avoid stale pan offset.
        if (newZoom === MIN_ZOOM) return INITIAL;
        // cursor in stage CSS-pixel space (before scale)
        const localX = (cursorX - fit.left - prev.px) / prev.zoom;
        const localY = (cursorY - fit.top - prev.py) / prev.zoom;
        return {
          zoom: newZoom,
          px: cursorX - fit.left - localX * newZoom,
          py: cursorY - fit.top - localY * newZoom,
        };
      });
    },
    [],
  );

  // Zoom from the center of the container (button clicks).
  const zoomFromCenter = useCallback(
    (factor: number) => {
      const c = containerRef.current;
      if (!c) return;
      const r = c.getBoundingClientRect();
      zoomAt(r.width / 2, r.height / 2, factor);
    },
    [containerRef, zoomAt],
  );

  const reset = useCallback(() => setTransform(INITIAL), []);
  const panBy = useCallback((dx: number, dy: number) => {
    setTransform((prev) => ({
      ...prev,
      px: prev.px + dx,
      py: prev.py + dy,
    }));
  }, []);

  // Non-passive wheel listener so we can preventDefault.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = container.getBoundingClientRect();
      const cx = e.clientX - r.left;
      const cy = e.clientY - r.top;
      const speed = e.ctrlKey ? PINCH_SPEED : ZOOM_SPEED;
      const factor = 1 - e.deltaY * speed;
      zoomAt(cx, cy, factor);
    };
    container.addEventListener("wheel", onWheel, { passive: false });
    return () => container.removeEventListener("wheel", onWheel);
  }, [containerRef, zoomAt]);

  return { transform, setFit, zoomFromCenter, reset, panBy };
}
