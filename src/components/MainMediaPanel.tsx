"use client";

import { useEffect, useRef } from "react";
import { useStore } from "@/lib/store";
import { AnnotationStage } from "./AnnotationStage";
import { VideoFramePicker } from "./VideoFramePicker";

export function MainMediaPanel() {
  const media = useStore((s) => s.media);
  const frames = useStore((s) => s.frames);
  const activeFrameId = useStore((s) => s.activeFrameId);
  const setActiveFrame = useStore((s) => s.setActiveFrame);
  const centerViewMode = useStore((s) => s.centerViewMode);
  const setCenterViewMode = useStore((s) => s.setCenterViewMode);
  const previewVideoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (centerViewMode !== "video") return;
    const preview = previewVideoRef.current;
    if (preview && !preview.paused) preview.pause();
  }, [centerViewMode]);


  useEffect(() => {
    if (centerViewMode !== "frame") return;

    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;

      const currentIndex = frames.findIndex((f) => f.id === activeFrameId);
      if (currentIndex < 0) return;
      const delta = e.key === "ArrowDown" ? 1 : -1;
      const nextIndex = Math.max(0, Math.min(frames.length - 1, currentIndex + delta));
      if (nextIndex === currentIndex) return;
      e.preventDefault();
      setActiveFrame(frames[nextIndex]?.id ?? null);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeFrameId, centerViewMode, frames, setActiveFrame]);

  if (!media) return null;

  if (media.kind !== "video") {
    return <AnnotationStage />;
  }

  if (centerViewMode === "video") {
    return <VideoFramePicker />;
  }

  return (
    <div className="relative h-full min-h-0">
      <AnnotationStage />
      <div className="pointer-events-auto absolute bottom-3 right-3 w-64 overflow-hidden rounded-md border border-[var(--color-line)] bg-black/80 shadow-xl">
        <video
          ref={previewVideoRef}
          src={media.url}
          className="aspect-video w-full"
          muted
          playsInline
          controls
          onPlay={() => setCenterViewMode("video")}
        />
        <button
          type="button"
          onClick={() => setCenterViewMode("video")}
          className="w-full border-t border-[var(--color-line)] px-2 py-1 text-xs text-[var(--color-text)] hover:bg-[var(--color-surface-2)]"
        >
          Return to video playback
        </button>
      </div>
    </div>
  );
}
