"use client";

import { useStore } from "@/lib/store";
import { FrameStrip } from "./FrameStrip";
import { LabelPanel } from "./LabelPanel";
import { MediaDropzone } from "./MediaDropzone";
import { Toolbar } from "./Toolbar";
import { TopBar } from "./TopBar";
import { MainMediaPanel } from "./MainMediaPanel";

export function Workspace() {
  const media = useStore((s) => s.media);

  return (
    <div className="flex h-screen flex-col overflow-hidden">
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
