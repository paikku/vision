"use client";

import { useRef } from "react";
import { useStore } from "@/lib/store";
import { LabelPanel, Toolbar, useKeyboardShortcuts } from "@/features/annotations";
import { FrameStrip } from "@/features/frames";
import { MediaDropzone, TopBar } from "@/features/media";
import { useReleaseNonTextFocus } from "@/shared/dom/useReleaseNonTextFocus";
import { MainMediaPanel } from "./MainMediaPanel";

export function Workspace() {
  const media = useStore((s) => s.media);
  const centerViewMode = useStore((s) => s.centerViewMode);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Register global keyboard shortcuts for the annotation workspace.
  useKeyboardShortcuts();

  // Release focus from non-text-input elements after every interaction so
  // global shortcuts stay live (see src/shared/dom/useReleaseNonTextFocus).
  useReleaseNonTextFocus(rootRef);

  return (
    <div ref={rootRef} className="flex h-screen flex-col overflow-hidden">
      <TopBar />
      {media ? (
        <div className="flex min-h-0 flex-1">
          <aside className="flex w-72 shrink-0 flex-col border-r border-[var(--color-line)] bg-[var(--color-surface)]">
            <div className="border-b border-[var(--color-line)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
              Frames
            </div>
            <FrameStrip />
          </aside>
          {centerViewMode !== "video" && <Toolbar />}
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
