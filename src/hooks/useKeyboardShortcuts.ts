"use client";

import { useEffect, useRef } from "react";
import { useStore } from "@/lib/store";
import { TOOL_LIST } from "@/lib/tools/registry";
import type { ClassShortcutKey, ToolId } from "@/lib/types";

const CLASS_KEYS = new Set<string>(["q", "w", "e", "r"]);

function isEditable(target: EventTarget | null) {
  if (!target) return false;
  const el = target as HTMLElement;
  if (el.isContentEditable) return true;
  const tag = el.tagName.toLowerCase();
  if (tag === "textarea" || tag === "select") return true;
  if (tag === "input") {
    const type = (el as HTMLInputElement).type.toLowerCase();
    return !["checkbox", "radio", "button", "submit", "reset", "file", "color", "range"].includes(type);
  }
  return false;
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

      // 1. Delete selected annotation (D key)
      if (key === "d") {
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

      // 3. Frame navigation (1 = previous, 2 = next)
      if (key === "1" || key === "2") {
        const { frames, activeFrameId } = useStore.getState();
        if (frames.length === 0) return;
        const idx = frames.findIndex((f) => f.id === activeFrameId);
        const next =
          key === "1"
            ? Math.max(0, idx - 1)
            : Math.min(frames.length - 1, idx + 1);
        if (idx !== next) {
          e.preventDefault();
          useStore.getState().setActiveFrame(frames[next].id);
        }
        return;
      }

      // 4. Draw/edit mode toggle
      if (key === "c") {
        e.preventDefault();
        const mode = useStore.getState().interactionMode;
        setInteractionMode(mode === "draw" ? "edit" : "draw");
        return;
      }

      // 5. Tool shortcuts
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
