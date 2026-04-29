"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildVideoSprite,
  captureFrameFromVideoElement,
  estimateVideoFps,
  type VideoSprite,
} from "@/features/media/service/capture";
import { BottomTimeline } from "@/features/media/ui/BottomTimeline";
import type { MediaSource } from "@/features/media/types";
import type { ResourceMeta } from "@/features/projects";
import {
  deleteImage as apiDeleteImage,
  getResource,
  imageUrl,
  resourceSourceUrl,
  uploadExtractedFrames,
} from "@/features/projects/service/api";
import { useStore } from "@/lib/store";
import { useReleaseNonTextFocus } from "@/shared/dom/useReleaseNonTextFocus";

const STEP_MIN = 1 / 240;
const STEP_MAX = 5;
const SHIFT_MULTIPLIER = 5;

export function FrameExtractionPage({
  projectId,
  resourceId,
}: {
  projectId: string;
  resourceId: string;
}) {
  const reset = useStore((s) => s.reset);
  const addFrames = useStore((s) => s.addFrames);
  const frames = useStore((s) => s.frames);
  const media = useStore((s) => s.media);
  const setFrameRange = useStore((s) => s.setFrameRange);

  const [resource, setResource] = useState<ResourceMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [sprite, setSprite] = useState<VideoSprite | null>(null);
  const [fps, setFps] = useState<number | null>(null);
  const [fpsDetecting, setFpsDetecting] = useState(false);
  const [stepSec, setStepSec] = useState(1);
  const stepInitializedRef = useRef(false);
  const rangeInitializedForRef = useRef<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const workspaceRef = useRef<HTMLDivElement | null>(null);

  // Frame upload tracking — same pattern as the old useProjectSync.
  const knownIdsRef = useRef<Set<string>>(new Set());
  const uploadingRef = useRef<Set<string>>(new Set());
  const generationRef = useRef(0);

  useReleaseNonTextFocus(workspaceRef);

  // Hydrate media + existing extracted frames.
  useEffect(() => {
    let cancelled = false;
    setError(null);
    reset();
    generationRef.current += 1;
    knownIdsRef.current = new Set();
    uploadingRef.current = new Set();
    rangeInitializedForRef.current = null;
    stepInitializedRef.current = false;
    setSprite(null);
    setFps(null);

    void (async () => {
      try {
        const { resource: meta, images } = await getResource(
          projectId,
          resourceId,
        );
        if (cancelled) return;
        setResource(meta);

        if (meta.kind !== "video") {
          throw new Error("frame extraction is only available for video resources");
        }

        // Fetch the video so capture pipeline has a File reference.
        const res = await fetch(resourceSourceUrl(projectId, resourceId));
        if (!res.ok) throw new Error(`video fetch failed: ${res.status}`);
        const blob = await res.blob();
        const file = new File([blob], meta.name, {
          type: blob.type || "video/mp4",
        });
        const blobUrl = URL.createObjectURL(file);
        const mediaSource: MediaSource = {
          id: meta.id,
          kind: "video",
          name: meta.name,
          url: blobUrl,
          width: meta.width ?? 0,
          height: meta.height ?? 0,
          duration: meta.duration,
          file,
          originalFile: file,
          ingestVia: meta.ingestVia,
        };

        // Hydrate already-extracted frames from this resource.
        const hydrated = images
          .filter((im) => im.source === "video_frame")
          .map((im) => ({
            id: im.id,
            resourceId: meta.id,
            url: imageUrl(projectId, im.id),
            width: im.width,
            height: im.height,
            timestamp: im.timestamp,
            label: im.name,
          }));
        for (const f of hydrated) knownIdsRef.current.add(f.id);

        useStore.setState({
          media: mediaSource,
          frames: hydrated,
          activeFrameId: hydrated[0]?.id ?? null,
        });
        if (typeof meta.duration === "number") {
          setDuration(meta.duration);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "리소스 로드 실패");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, resourceId]);

  useEffect(() => {
    return () => reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Range init.
  useEffect(() => {
    if (!media || media.kind !== "video" || duration <= 0) return;
    if (rangeInitializedForRef.current === media.id) return;
    rangeInitializedForRef.current = media.id;
    setFrameRange({ start: 0, end: duration });
  }, [duration, media, setFrameRange]);

  // FPS detection.
  useEffect(() => {
    if (!media || media.kind !== "video") return;
    const video = videoRef.current;
    if (!video) return;
    let canceled = false;
    const run = async () => {
      if (video.readyState < 1) {
        await new Promise<void>((resolve) => {
          const ok = () => {
            video.removeEventListener("loadedmetadata", ok);
            resolve();
          };
          video.addEventListener("loadedmetadata", ok);
        });
      }
      if (canceled) return;
      setFpsDetecting(true);
      try {
        const detected = await estimateVideoFps(video);
        if (canceled) return;
        if (detected && detected > 0) {
          setFps(detected);
          if (!stepInitializedRef.current) {
            setStepSec(Math.max(STEP_MIN, Math.min(STEP_MAX, 1 / detected)));
            stepInitializedRef.current = true;
          }
        }
      } finally {
        if (!canceled) setFpsDetecting(false);
      }
    };
    void run();
    return () => {
      canceled = true;
    };
  }, [media]);

  // Sprite.
  useEffect(() => {
    let canceled = false;
    if (!media || media.kind !== "video") return;
    void buildVideoSprite(media, {
      maxFrames: 72,
      thumbWidth: 150,
    })
      .then((next) => {
        if (canceled) {
          URL.revokeObjectURL(next.url);
          return;
        }
        setSprite((prev) => {
          if (prev?.url) URL.revokeObjectURL(prev.url);
          return next;
        });
      });
    return () => {
      canceled = true;
    };
  }, [media]);

  useEffect(() => {
    return () => {
      if (sprite?.url) URL.revokeObjectURL(sprite.url);
    };
  }, [sprite?.url]);

  const captureCurrent = useCallback(async () => {
    if (!media || media.kind !== "video") return;
    const video = videoRef.current;
    if (!video) return;
    setBusy(true);
    try {
      const frame = await captureFrameFromVideoElement(media, video);
      if (frame) addFrames([{ ...frame, resourceId: media.id }]);
    } finally {
      setBusy(false);
    }
  }, [addFrames, media]);

  const seek = useCallback((t: number) => {
    setTime(t);
    const v = videoRef.current;
    if (v) v.currentTime = t;
  }, []);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      void v.play();
    } else {
      v.pause();
    }
  }, []);

  // Sync: upload new (blob:) frames; delete frames removed from the store.
  useEffect(() => {
    const gen = generationRef.current;
    const currentIds = new Set(frames.map((f) => f.id));

    for (const prev of knownIdsRef.current) {
      if (!currentIds.has(prev)) {
        void apiDeleteImage(projectId, prev).catch(() => {});
        knownIdsRef.current.delete(prev);
      }
    }

    const newFrames = frames.filter(
      (f) =>
        !knownIdsRef.current.has(f.id) &&
        !uploadingRef.current.has(f.id) &&
        f.url.startsWith("blob:"),
    );
    if (newFrames.length === 0) return;
    newFrames.forEach((f) => uploadingRef.current.add(f.id));
    void (async () => {
      const inputs = await Promise.all(
        newFrames.map(async (f) => ({
          id: f.id,
          blob: await fetch(f.url).then((r) => r.blob()),
          width: f.width,
          height: f.height,
          timestamp: f.timestamp,
          name: f.label,
        })),
      );
      try {
        const stored = await uploadExtractedFrames(
          projectId,
          resourceId,
          inputs,
        );
        if (generationRef.current !== gen) return;
        const idToExt = new Map(stored.map((im) => [im.id, im] as const));
        useStore.setState((s) => ({
          frames: s.frames.map((f) => {
            if (!idToExt.has(f.id)) return f;
            if (f.url.startsWith("blob:")) URL.revokeObjectURL(f.url);
            return { ...f, url: imageUrl(projectId, f.id) };
          }),
        }));
        for (const im of stored) {
          knownIdsRef.current.add(im.id);
          uploadingRef.current.delete(im.id);
        }
      } catch {
        if (generationRef.current !== gen) return;
        for (const f of newFrames) uploadingRef.current.delete(f.id);
      }
    })();
  }, [frames, projectId, resourceId]);

  // Keyboard.
  useEffect(() => {
    if (!media || media.kind !== "video") return;
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      const video = videoRef.current;
      if (!video) return;
      if (e.code === "Space") {
        e.preventDefault();
        if (video.paused) void video.play();
        else video.pause();
      } else if (e.code === "KeyC") {
        e.preventDefault();
        void captureCurrent();
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        const delta = e.shiftKey ? stepSec * SHIFT_MULTIPLIER : stepSec;
        const next = Math.min(duration, video.currentTime + delta);
        video.currentTime = next;
        setTime(next);
      } else if (e.code === "ArrowLeft") {
        e.preventDefault();
        const delta = e.shiftKey ? stepSec * SHIFT_MULTIPLIER : stepSec;
        const next = Math.max(0, video.currentTime - delta);
        video.currentTime = next;
        setTime(next);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [captureCurrent, duration, media, stepSec]);

  const stepMin = useMemo(
    () => (fps ? Math.max(STEP_MIN, 1 / fps) : 0.01),
    [fps],
  );

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--color-bg)] p-6 text-sm">
        <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-6">
          <div className="mb-2 font-semibold text-[var(--color-danger)]">로드 실패</div>
          <div className="mb-4 text-[var(--color-muted)]">{error}</div>
          <Link
            href={`/projects/${projectId}`}
            className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-xs font-medium text-black"
          >
            프로젝트로 돌아가기
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div ref={workspaceRef} className="flex h-screen flex-col overflow-hidden">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--color-line)] bg-[var(--color-surface)] px-4">
        <div className="flex items-center gap-3">
          <Link
            href={`/projects/${projectId}`}
            className="text-xs text-[var(--color-muted)] hover:text-[var(--color-text)]"
          >
            ← 프로젝트로
          </Link>
          <span className="rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
            Frame Extraction
          </span>
          <span className="max-w-[40ch] truncate text-sm font-medium">
            {resource?.name ?? "…"}
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs text-[var(--color-muted)]">
          {frames.length} frames · 자동 저장됨
        </div>
      </header>

      {media && media.kind === "video" ? (
        <div className="flex min-h-0 flex-1 flex-col bg-[var(--color-surface)]">
          <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
            <div className="relative min-h-[280px] flex-1 overflow-hidden rounded-md bg-black">
              <video
                ref={videoRef}
                src={media.url}
                className="h-full w-full object-contain"
                muted
                playsInline
                onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
                onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
              />
            </div>

            <div className="flex flex-wrap items-center gap-2 rounded-md border border-[var(--color-line)] px-2 py-1 text-[11px] text-[var(--color-muted)]">
              <span>←/→ 스텝</span>
              <input
                type="number"
                min={STEP_MIN}
                max={STEP_MAX}
                step={0.001}
                value={Number(stepSec.toFixed(3))}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  if (Number.isFinite(v))
                    setStepSec(Math.max(STEP_MIN, Math.min(STEP_MAX, v)));
                }}
                className="w-20 rounded bg-[var(--color-surface-2)] px-1 py-0.5 text-center text-[var(--color-text)] tabular-nums outline-none"
              />
              <span>s</span>
              {fps && (
                <button
                  type="button"
                  onClick={() => setStepSec(stepMin)}
                  className="rounded border border-[var(--color-line)] px-1.5 py-0.5 hover:text-[var(--color-text)]"
                  title={`1 frame at ${fps} fps`}
                >
                  1프레임 ({stepMin.toFixed(3)}s)
                </button>
              )}
              <span className="ml-auto tabular-nums">
                {fpsDetecting
                  ? "fps 추정중…"
                  : fps
                  ? `${fps} fps · 가이드 ${stepMin.toFixed(3)}~1.00s`
                  : "fps 추정 실패 — 직접 입력"}
              </span>
            </div>
          </div>

          <BottomTimeline
            media={media}
            duration={duration}
            sprite={sprite}
            fps={fps}
            cursorTime={time}
            onSeek={seek}
            captureCurrent={captureCurrent}
            togglePlay={togglePlay}
            isPlaying={isPlaying}
            busy={busy}
            setBusy={setBusy}
          />
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center text-sm text-[var(--color-muted)]">
          불러오는 중…
        </div>
      )}
    </div>
  );
}
