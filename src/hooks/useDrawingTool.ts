"use client";

import {
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useEffect,
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
  interactionMode: "draw" | "edit";
  onBeginDraw: () => void;
  onCommit: (frameId: string, classId: string, shape: Shape) => void;
};

/**
 * Click-to-click annotation drawing.
 *
 * - Click 1: anchor first corner, preview follows mouse.
 * - Click 2: commit the shape.
 * - Right-click or Escape while pending: cancel.
 */
export function useDrawingTool({
  stageRef,
  frame,
  activeClassId,
  activeToolId,
  interactionMode,
  onBeginDraw,
  onCommit,
}: DrawingToolOptions) {
  const draftRef = useRef<ShapeDraft | null>(null);
  // "pending" = first click placed, waiting for second click
  const phaseRef = useRef<"idle" | "pending">("idle");
  const [draftShape, setDraftShape] = useState<Shape | null>(null);

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

  const cancelDraft = useCallback(() => {
    draftRef.current = null;
    setDraftShape(null);
    phaseRef.current = "idle";
  }, []);

  const tool = TOOLS[activeToolId];

  // Cancel on Escape key while a draft is pending.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && phaseRef.current === "pending") cancelDraft();
    };
    window.addEventListener("keydown", handler, { capture: true });
    return () => window.removeEventListener("keydown", handler, { capture: true });
  }, [cancelDraft]);

  // Cancel pending draft when tool, frame, or interaction mode changes.
  useEffect(() => { cancelDraft(); }, [activeToolId, frame?.id, interactionMode, cancelDraft]);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const { frame: f, activeClassId: cid, onBeginDraw: begin, onCommit: commit } =
        optsRef.current;
      if (!f || !cid || tool.disabled) return;

      // Right-click cancels a pending draft.
      if (e.button === 2) {
        cancelDraft();
        return;
      }
      if (e.button !== 0) return;
      e.preventDefault();

      if (phaseRef.current === "idle") {
        // First click: anchor
        begin();
        const start = toNorm(e);
        draftRef.current = tool.begin(start);
        setDraftShape(draftRef.current.update(start));
        phaseRef.current = "pending";
      } else {
        // Second click: commit
        if (!draftRef.current) { phaseRef.current = "idle"; return; }
        const end = toNorm(e);
        const shape = draftRef.current.commit(end);
        draftRef.current = null;
        setDraftShape(null);
        phaseRef.current = "idle";
        if (shape) commit(f.id, cid, shape);
      }
    },
    [tool, toNorm, cancelDraft],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!draftRef.current) return;
      setDraftShape(draftRef.current.update(toNorm(e)));
    },
    [toNorm],
  );

  // pointerUp is a no-op in click-to-click mode.
  const onPointerUp = useCallback(() => {}, []);

  return {
    draftShape,
    cursor: tool.disabled ? "not-allowed" : tool.cursor,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: cancelDraft,
    },
  };
}
