"use client";

import {
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { Frame } from "@/features/frames/types";
import type { Point } from "@/shared/types";
import { TOOLS } from "../tools/registry";
import type { ShapeDraft } from "../tools/types";
import type { Shape, ToolId } from "../types";

type DrawingToolOptions = {
  stageRef: RefObject<HTMLDivElement | null>;
  frame: Frame | null;
  activeClassId: string | null;
  activeToolId: ToolId;
  interactionMode: "draw" | "edit";
  onBeginDraw: () => void;
  onCommit: (
    frameId: string,
    classId: string,
    kind: "rect" | "polygon",
    shape: Shape,
  ) => void;
};

/**
 * Click-to-click annotation drawing.
 *
 * - Click 1: anchor first point, preview follows mouse (phase = "pending").
 * - Click 2+: the tool decides via `addPoint` whether this click commits
 *   (rect: yes on click 2; polygon: yes when near first vertex) or just
 *   adds another vertex and keeps drafting.
 * - `Enter` while pending: ask the tool to close (`tryClose`).
 * - Right-click or `Escape` while pending: cancel.
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
  // "pending" = first click placed, waiting for next click(s)
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

  // Cancel on Escape, or close on Enter (if the tool supports it).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (phaseRef.current !== "pending") return;
      if (e.key === "Escape") {
        cancelDraft();
        return;
      }
      if (e.key === "Enter" && draftRef.current?.tryClose) {
        const shape = draftRef.current.tryClose();
        if (!shape) return;
        e.preventDefault();
        const { frame: f, activeClassId: cid, onCommit: commit } = optsRef.current;
        cancelDraft();
        if (f && cid && (shape.kind === "rect" || shape.kind === "polygon")) {
          commit(f.id, cid, shape.kind, shape);
        }
      }
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
        return;
      }

      // Subsequent click: let the tool decide
      if (!draftRef.current) { phaseRef.current = "idle"; return; }
      const p = toNorm(e);
      const { done, shape } = draftRef.current.addPoint(p);
      if (done) {
        draftRef.current = null;
        setDraftShape(null);
        phaseRef.current = "idle";
        if (shape && (shape.kind === "rect" || shape.kind === "polygon")) {
          commit(f.id, cid, shape.kind, shape);
        }
      } else {
        setDraftShape(shape ?? draftRef.current.update(p));
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
