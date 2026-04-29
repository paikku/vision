"use client";

import { useEffect, useRef } from "react";
import { selectVisibleFrames, useStore } from "@/lib/store";
import { isEditableElement } from "@/shared/dom/isEditableElement";
import { TOOL_LIST } from "../tools/registry";
import type { ClassShortcutKey, ToolId } from "../types";

const CLASS_KEYS = new Set<string>(["q", "w", "e", "r"]);

/**
 * Global keyboard shortcuts for the annotation workspace.
 *
 * Priority order (highest first):
 *   1. Delete / Backspace → remove selected annotation (shape modes only)
 *   2. Q/W/E/R → switch active class (or, in classify mode, toggle on the active image — handled by LabelPanel)
 *   3. 1/2 → previous / next image
 *   4. C → toggle draw/edit (shape modes only)
 *   5. Tool shortcuts (R for rect, etc., shape modes only)
 *
 * Note: LabelPanel registers a capture-phase listener that intercepts
 * Q/W/E/R for hover-class assignment + classify-toggle, so those
 * never reach this handler in those scenarios.
 */
export function useKeyboardShortcuts() {
  const setActiveTool = useStore((s) => s.setActiveTool);
  const setInteractionMode = useStore((s) => s.setInteractionMode);

  const classesRef = useRef(useStore.getState().classes);
  const selectedAnnotationIdRef = useRef(
    useStore.getState().selectedAnnotationId,
  );
  const taskTypeRef = useRef(useStore.getState().taskType);

  useEffect(() => {
    return useStore.subscribe((state) => {
      classesRef.current = state.classes;
      selectedAnnotationIdRef.current = state.selectedAnnotationId;
      taskTypeRef.current = state.taskType;
    });
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isEditableElement(e.target)) return;
      const key = e.key.toLowerCase();
      const isClassify = taskTypeRef.current === "classify";

      // 1. Delete selected shape annotation
      if (!isClassify && key === "d") {
        const selected = selectedAnnotationIdRef.current;
        if (selected) {
          e.preventDefault();
          useStore.getState().removeAnnotation(selected);
        }
        return;
      }

      // 2. Class shortcuts (Q/W/E/R) — switch active class
      if (!isClassify && CLASS_KEYS.has(key)) {
        const klass = classesRef.current.find(
          (c) => c.shortcutKey === (key as ClassShortcutKey),
        );
        if (klass) {
          e.preventDefault();
          useStore.getState().setActiveClass(klass.id);
          return;
        }
      }

      // 3. Frame navigation (1 = previous, 2 = next)
      if (key === "1" || key === "2") {
        const state = useStore.getState();
        const visible = selectVisibleFrames(state);
        if (visible.length === 0) return;
        const idx = visible.findIndex((f) => f.id === state.activeFrameId);
        const next =
          idx < 0
            ? 0
            : key === "1"
              ? Math.max(0, idx - 1)
              : Math.min(visible.length - 1, idx + 1);
        if (idx !== next) {
          e.preventDefault();
          state.setActiveFrame(visible[next].id);
        }
        return;
      }

      // 4. Draw/edit mode toggle (shape modes only)
      if (!isClassify && key === "c") {
        e.preventDefault();
        const mode = useStore.getState().interactionMode;
        setInteractionMode(mode === "draw" ? "edit" : "draw");
        return;
      }

      // 5. Tool shortcuts (shape modes only)
      if (!isClassify) {
        const tool = TOOL_LIST.find(
          (t) => !t.disabled && t.shortcut?.toLowerCase() === key,
        );
        if (tool) {
          e.preventDefault();
          setActiveTool(tool.id as ToolId);
        }
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [setActiveTool, setInteractionMode]);
}
