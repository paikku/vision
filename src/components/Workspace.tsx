"use client";

import { useStore } from "@/lib/store";
import { AnnotationStage } from "./AnnotationStage";
import { FrameStrip } from "./FrameStrip";
import { LabelPanel } from "./LabelPanel";
import { MediaDropzone } from "./MediaDropzone";
import { Toolbar } from "./Toolbar";
import { TopBar } from "./TopBar";
import { VideoFramePicker } from "./VideoFramePicker";

export function Workspace() {
  const media = useStore((s) => s.media);

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <TopBar />
      {media ? (
        <div className="flex min-h-0 flex-1">
          <aside className="flex w-64 shrink-0 flex-col border-r border-[var(--color-line)] bg-[var(--color-surface)]">
            <VideoFramePicker />
            <FrameStrip />
          </aside>
          <Toolbar />
          <main className="relative min-w-0 flex-1">
            <AnnotationStage />
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
