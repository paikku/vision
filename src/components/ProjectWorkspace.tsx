"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { LabelPanel, Toolbar, useKeyboardShortcuts } from "@/features/annotations";
import { FrameStrip } from "@/features/frames";
import type { Frame } from "@/features/frames/types";
import type { MediaSource } from "@/features/media";
import {
  frameImageUrl,
  getVideoData,
  videoSourceUrl,
} from "@/features/projects/service/api";
import { useStore } from "@/lib/store";
import { MainMediaPanel } from "./MainMediaPanel";
import { ProjectTopBar } from "./ProjectTopBar";
import { useProjectSync } from "./useProjectSync";

export function ProjectWorkspace({
  projectId,
  videoId,
}: {
  projectId: string;
  videoId: string;
}) {
  const media = useStore((s) => s.media);
  const [initialized, setInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resetRef = useRef(useStore.getState().reset);

  useKeyboardShortcuts();

  // Hydrate the workspace store from server data for this video.
  useEffect(() => {
    let cancelled = false;
    setInitialized(false);
    setError(null);
    const reset = resetRef.current;
    reset();

    void (async () => {
      try {
        const { meta, data } = await getVideoData(projectId, videoId);
        if (cancelled) return;

        // Fetch the video source to give the workspace a File for frame
        // extraction/capture to keep working. This is a one-shot cost at
        // page mount; streamed download would be nicer but overkill here.
        let mediaSource: MediaSource;
        const srcUrl = videoSourceUrl(projectId, videoId);
        if (meta.kind === "video") {
          const res = await fetch(srcUrl);
          if (!res.ok) throw new Error(`video fetch failed: ${res.status}`);
          const blob = await res.blob();
          const file = new File([blob], meta.name, {
            type: blob.type || "video/mp4",
          });
          const blobUrl = URL.createObjectURL(file);
          mediaSource = {
            id: meta.id,
            kind: "video",
            name: meta.name,
            url: blobUrl,
            width: meta.width,
            height: meta.height,
            duration: meta.duration,
            file,
            originalFile: file,
            ingestVia: meta.ingestVia,
          };
        } else {
          mediaSource = {
            id: meta.id,
            kind: "image",
            name: meta.name,
            url: srcUrl,
            width: meta.width,
            height: meta.height,
            ingestVia: meta.ingestVia,
          };
        }

        const frames: Frame[] = data.frames.map((f) => ({
          id: f.id,
          mediaId: meta.id,
          url: frameImageUrl(projectId, videoId, f.id),
          width: f.width,
          height: f.height,
          timestamp: f.timestamp,
          label: f.label,
        }));

        // Install into store authoritatively — any state carried over from a
        // previous project/video would be wrong. If the server has no saved
        // classes yet, seed with a single default so the user can start
        // drawing immediately.
        const classes =
          data.classes.length > 0
            ? data.classes
            : [{ id: "default", name: "object", color: "#5b8cff" }];
        useStore.setState({
          media: mediaSource,
          frames,
          activeFrameId: frames[0]?.id ?? null,
          annotations: data.annotations,
          classes,
          activeClassId: classes[0].id,
          centerViewMode: mediaSource.kind === "video" ? "video" : "frame",
        });

        if (!cancelled) setInitialized(true);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load video");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, videoId]);

  // Clean up media blob + frame URLs on unmount. (Frames loaded from server
  // use remote URLs so revoke is a no-op for them; the video blob URL does
  // need the revoke.)
  useEffect(() => {
    const reset = resetRef.current;
    return () => reset();
  }, []);

  useProjectSync({ projectId, videoId, initialized });

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      const tag = el.tagName.toLowerCase();
      if (tag === "button") {
        requestAnimationFrame(() => el.blur());
      } else if (tag === "input") {
        const type = (el as HTMLInputElement).type.toLowerCase();
        if (["checkbox", "radio"].includes(type)) {
          requestAnimationFrame(() => el.blur());
        }
      }
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, []);

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--color-bg)] p-6 text-[var(--text-sm)]">
        <div className="rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] p-6 shadow-[var(--shadow-md)]">
          <div className="mb-2 font-semibold text-[var(--color-danger)]">비디오 로드 실패</div>
          <div className="mb-4 text-[var(--color-muted)]">{error}</div>
          <Link
            href={`/projects/${projectId}`}
            className="inline-flex h-7 items-center rounded-[var(--radius-md)] bg-[var(--color-accent)] px-3 text-[var(--text-xs)] font-medium text-[var(--color-accent-contrast)] transition-colors hover:bg-[var(--color-accent-hover)]"
          >
            프로젝트로 돌아가기
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <ProjectTopBar projectId={projectId} />
      {media ? (
        <div className="flex min-h-0 flex-1">
          <aside className="flex w-72 shrink-0 flex-col border-r border-[var(--color-line)] bg-[var(--color-surface)]">
            <div className="border-b border-[var(--color-line)] px-3 py-2 text-[var(--text-2xs)] font-semibold uppercase tracking-wide text-[var(--color-muted)]">
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
        <div className="flex flex-1 items-center justify-center text-[var(--text-sm)] text-[var(--color-muted)]">
          불러오는 중…
        </div>
      )}
    </div>
  );
}
