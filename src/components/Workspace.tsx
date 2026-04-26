"use client";

import { useEffect, useRef } from "react";
import { useStore } from "@/lib/store";
import { LabelPanel, Toolbar, useKeyboardShortcuts } from "@/features/annotations";
import { FrameStrip } from "@/features/frames";
import { MediaDropzone, TopBar } from "@/features/media";
import { isEditableElement } from "@/shared/dom/isEditableElement";
import { MainMediaPanel } from "./MainMediaPanel";

export function Workspace() {
  const media = useStore((s) => s.media);
  const workspaceRef = useRef<HTMLDivElement | null>(null);

  // Register global keyboard shortcuts for the annotation workspace.
  useKeyboardShortcuts();

  // Clear stale text focus inside the workspace when the user clicks another
  // non-editable control so keyboard shortcuts stay responsive.
  useEffect(() => {
    const root = workspaceRef.current;
    if (!root) return;

    const clearFocusOnPointerDown = (e: PointerEvent) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      if (!root.contains(target)) return;
      if (isEditableElement(target)) return;

      const active = document.activeElement as HTMLElement | null;
      if (!active || active === document.body) return;
      if (!root.contains(active)) return;
      if (active.contains(target)) return;

      requestAnimationFrame(() => active.blur());
    };

    root.addEventListener("pointerdown", clearFocusOnPointerDown, true);
    return () =>
      root.removeEventListener("pointerdown", clearFocusOnPointerDown, true);
  }, []);

  return (
    <div ref={workspaceRef} className="flex h-screen flex-col overflow-hidden">
      <TopBar />
      {media ? (
        <div className="flex min-h-0 flex-1">
          <aside className="flex w-72 shrink-0 flex-col border-r border-[var(--color-line)] bg-[var(--color-surface)]">
            <div className="border-b border-[var(--color-line)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
              Frames
            </div>
            <FrameStrip />
          </aside>
          <Toolbar />
          <main className="relative min-w-0 flex-1 bg-[var(--color-bg)]">
            <MainMediaPanel />
          </main>
          <LabelPanel />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <MediaDropzone />
        </div>
      )}
    </div>
  );
}
