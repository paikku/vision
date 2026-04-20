"use client";

import { useEffect, useRef } from "react";
import { useStore } from "@/lib/store";
import { TOOL_LIST } from "@/lib/tools/registry";
import type { ClassShortcutKey, ToolId } from "@/lib/types";

const CLASS_KEYS = new Set<string>(["q", "w", "e", "r"]);

function isEditable(target: EventTarget | null) {
  if (!target) return false;
  const el = target as HTMLElement;
  return /input|textarea|select/i.test(el.tagName) || el.isContentEditable;
}

/**
 * Global keyboard shortcuts for the annotation workspace.
 * Call once from Workspace so shortcuts are active regardless of focus.
 *
 * Priority order (highest first):
 *   1. Delete / Backspace → remove selected annotation
 *   2. Q/W/E/R → switch active class if a class owns that key
 *   3. Tool shortcuts (R for rect, etc.)
 *
 * Note: LabelPanel registers a capture-phase listener that intercepts
 * Q/W/E/R when hovering a class row (for shortcut assignment), so those
 * events never reach this handler in that scenario.
 */
export function useKeyboardShortcuts() {
  const setActiveTool = useStore((s) => s.setActiveTool);
  const setInteractionMode = useStore((s) => s.setInteractionMode);

  // Use refs for frequently-changing values to keep the effect stable.
  const classesRef = useRef(useStore.getState().classes);
  const selectedAnnotationIdRef = useRef(
    useStore.getState().selectedAnnotationId,
  );

  useEffect(() => {
    return useStore.subscribe((state) => {
      classesRef.current = state.classes;
      selectedAnnotationIdRef.current = state.selectedAnnotationId;
    });
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isEditable(e.target)) return;
      const key = e.key.toLowerCase();

      // 1. Delete selected annotation
      if (key === "delete" || key === "backspace") {
        const selected = selectedAnnotationIdRef.current;
        if (selected) {
          e.preventDefault();
          useStore.getState().removeAnnotation(selected);
        }
        return;
      }

      // 2. Class shortcuts (Q/W/E/R)
      if (CLASS_KEYS.has(key)) {
        const klass = classesRef.current.find(
          (c) => c.shortcutKey === (key as ClassShortcutKey),
        );
        if (klass) {
          e.preventDefault();
          useStore.getState().setActiveClass(klass.id);
          return;
        }
      }

      // 3. Tool shortcuts
      if (key === "c") {
        e.preventDefault();
        const mode = useStore.getState().interactionMode;
        setInteractionMode(mode === "draw" ? "edit" : "draw");
        return;
      }

      // 4. Tool shortcuts
      const tool = TOOL_LIST.find(
        (t) => !t.disabled && t.shortcut?.toLowerCase() === key,
      );
      if (tool) {
        e.preventDefault();
        setActiveTool(tool.id as ToolId);
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [setActiveTool, setInteractionMode]);
}
