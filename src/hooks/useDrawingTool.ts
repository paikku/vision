"use client";

import {
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useRef,
  useState,
} from "react";
import { TOOLS } from "@/lib/tools/registry";
import type { ShapeDraft } from "@/lib/tools/types";
import type { Frame, Point, Shape, ToolId } from "@/lib/types";

type DrawingToolOptions = {
  stageRef: RefObject<HTMLDivElement | null>;
  frame: Frame | null;
  activeClassId: string | null;
  activeToolId: ToolId;
  /** Called when drawing starts (to clear annotation selection). */
  onBeginDraw: () => void;
  /** Called when a shape is successfully committed. */
  onCommit: (frameId: string, classId: string, shape: Shape) => void;
};

/**
 * Handles all pointer-capture logic for annotation drawing.
 * Works with any AnnotationTool from the registry.
 * getBoundingClientRect() on the stage div accounts for CSS transforms,
 * so toNorm is correct even when the stage is zoomed/panned.
 */
export function useDrawingTool({
  stageRef,
  frame,
  activeClassId,
  activeToolId,
  onBeginDraw,
  onCommit,
}: DrawingToolOptions) {
  const draftRef = useRef<ShapeDraft | null>(null);
  const pointerIdRef = useRef<number | null>(null);
  const [draftShape, setDraftShape] = useState<Shape | null>(null);

  // Keep mutable options in ref to avoid stale closures in event handlers.
  const optsRef = useRef({ frame, activeClassId, onBeginDraw, onCommit });
  optsRef.current = { frame, activeClassId, onBeginDraw, onCommit };

  const toNorm = useCallback((e: ReactPointerEvent | PointerEvent): Point => {
    const stage = stageRef.current;
    if (!stage) return { x: 0, y: 0 };
    const rect = stage.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    };
  }, [stageRef]);

  const tool = TOOLS[activeToolId];

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const { frame: f, activeClassId: cid, onBeginDraw: begin } = optsRef.current;
      if (!f || !cid || tool.disabled || e.button !== 0) return;
      e.preventDefault();
      begin();
      pointerIdRef.current = e.pointerId;
      (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
      const start = toNorm(e);
      draftRef.current = tool.begin(start);
      setDraftShape(draftRef.current.update(start));
    },
    [tool, toNorm],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!draftRef.current) return;
      setDraftShape(draftRef.current.update(toNorm(e)));
    },
    [toNorm],
  );

  const finishDraft = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const { frame: f, activeClassId: cid, onCommit: commit } = optsRef.current;
      if (!draftRef.current || !f || !cid) return;
      const shape = draftRef.current.commit(toNorm(e));
      draftRef.current = null;
      setDraftShape(null);
      if (pointerIdRef.current !== null) {
        try {
          (e.currentTarget as HTMLDivElement).releasePointerCapture(
            pointerIdRef.current,
          );
        } catch {
          /* noop */
        }
        pointerIdRef.current = null;
      }
      if (shape) commit(f.id, cid, shape);
    },
    [toNorm],
  );

  return {
    draftShape,
    cursor: tool.disabled ? "not-allowed" : tool.cursor,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: finishDraft,
      onPointerCancel: finishDraft,
    },
  };
}
