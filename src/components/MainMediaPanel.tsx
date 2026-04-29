"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { AnnotationStage } from "@/features/annotations";
import {
  buildVideoSprite,
  captureFrameFromVideoElement,
  estimateVideoFps,
  type VideoSprite,
} from "@/features/media/service/capture";
import { BottomTimeline, type CaptureProgress } from "@/features/media/ui/BottomTimeline";

const STEP_MIN = 1 / 240;
const STEP_MAX = 5;
const SHIFT_MULTIPLIER = 5;

export function MainMediaPanel() {
  const media = useStore((s) => s.media);
  const frames = useStore((s) => s.frames);
  const activeFrameId = useStore((s) => s.activeFrameId);
  const setActiveFrame = useStore((s) => s.setActiveFrame);
  const centerViewMode = useStore((s) => s.centerViewMode);
  const setCenterViewMode = useStore((s) => s.setCenterViewMode);
  const addFrames = useStore((s) => s.addFrames);
  const setFrameRange = useStore((s) => s.setFrameRange);

  const videoRef = useRef<HTMLVideoElement>(null);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(
    media?.kind === "video" ? media.duration ?? 0 : 0,
  );
  const [sprite, setSprite] = useState<VideoSprite | null>(null);
  const [fps, setFps] = useState<number | null>(null);
  const [fpsDetecting, setFpsDetecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<CaptureProgress>(null);
  const [spriteProgress, setSpriteProgress] =
    useState<{ done: number; total: number } | null>(null);
  const [stepSec, setStepSec] = useState(1);
  const stepInitializedRef = useRef(false);
  const rangeInitializedForRef = useRef<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const isVideoMode = centerViewMode === "video";

  // Active-frame timestamp for the timeline cursor in frame mode.
  const activeFrameTimestamp = useMemo(() => {
    if (isVideoMode) return null;
    const f = frames.find((x) => x.id === activeFrameId);
    return f && typeof f.timestamp === "number" ? f.timestamp : null;
  }, [activeFrameId, frames, isVideoMode]);

  const cursorTime = isVideoMode ? time : activeFrameTimestamp;

  // Reset on media change.
  useEffect(() => {
    if (!media || media.kind !== "video") return;
    setTime(0);
    setDuration(media.duration ?? 0);
    setFps(null);
    setFpsDetecting(false);
    stepInitializedRef.current = false;
    rangeInitializedForRef.current = null;
  }, [media]);

  // Initialize range to the full [0, duration] once duration becomes valid.
  // This intentionally runs once per media so user-edited ranges aren't reset
  // by re-renders.
  useEffect(() => {
    if (!media || media.kind !== "video" || duration <= 0) return;
    if (rangeInitializedForRef.current === media.id) return;
    rangeInitializedForRef.current = media.id;
    setFrameRange({ start: 0, end: duration });
  }, [duration, media, setFrameRange]);

  // Auto-detect fps once metadata is loaded.
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

  // Build sprite once per media.
  useEffect(() => {
    let canceled = false;
    if (!media || media.kind !== "video") return;
    void buildVideoSprite(media, {
      maxFrames: 72,
      thumbWidth: 150,
      onProgress: (done, total) => {
        if (canceled) return;
        setSpriteProgress({ done, total });
      },
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
      })
      .finally(() => {
        if (!canceled) setSpriteProgress(null);
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
      if (frame) addFrames([frame]);
    } finally {
      setBusy(false);
    }
  }, [addFrames, media]);

  const seek = useCallback(
    (t: number) => {
      setTime(t);
      const v = videoRef.current;
      if (v) v.currentTime = t;
      if (!isVideoMode) {
        if (v) v.pause();
        setCenterViewMode("video");
      }
    },
    [isVideoMode, setCenterViewMode],
  );

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      setCenterViewMode("video");
      void v.play();
    } else {
      v.pause();
    }
  }, [setCenterViewMode]);

  // Keyboard shortcuts. Frame mode handles ArrowUp/Down navigation only;
  // video mode handles Space/C/Arrow stepping.
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

      if (!isVideoMode) {
        if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
        const idx = frames.findIndex((f) => f.id === activeFrameId);
        if (idx < 0) return;
        const delta = e.key === "ArrowDown" ? 1 : -1;
        const nextIdx = Math.max(
          0,
          Math.min(frames.length - 1, idx + delta),
        );
        if (nextIdx === idx) return;
        e.preventDefault();
        setActiveFrame(frames[nextIdx]?.id ?? null);
        return;
      }

      const video = videoRef.current;
      if (!video) return;
      if (e.code === "Space") {
        e.preventDefault();
        if (video.paused) {
          setCenterViewMode("video");
          void video.play();
        } else video.pause();
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
  }, [
    activeFrameId,
    captureCurrent,
    duration,
    frames,
    isVideoMode,
    media,
    setActiveFrame,
    setCenterViewMode,
    stepSec,
  ]);

  if (!media) return null;
  if (media.kind !== "video") return <AnnotationStage />;

  const stepMin = fps ? Math.max(STEP_MIN, 1 / fps) : 0.01;

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--color-surface)]">
      {/* Top: annotation stage (frame mode) or video player (video mode).
          The <video> element is always mounted so fps detection / seeks /
          captureCurrent keep working when the user toggles into edit mode. */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        {!isVideoMode && (
          <>
            <AnnotationStage />
            <button
              type="button"
              onClick={() => setCenterViewMode("video")}
              className="absolute bottom-3 right-3 rounded-md border border-[var(--color-line)] bg-black/80 px-3 py-1.5 text-xs text-[var(--color-text)] shadow-xl hover:bg-[var(--color-surface-2)]"
            >
              비디오 재생으로 전환
            </button>
          </>
        )}
        <div
          className={
            isVideoMode
              ? "flex min-h-0 flex-1 flex-col gap-3 p-3"
              : "hidden"
          }
        >
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
      </div>

      {(spriteProgress || progress) && (
        <div className="px-3 pt-1 text-xs text-[var(--color-muted)]">
          {spriteProgress && (
            <span>
              building timeline {spriteProgress.done}/{spriteProgress.total}…{" "}
            </span>
          )}
          {progress && (
            <span>
              extracting frames {progress.done}/{progress.total}…
            </span>
          )}
        </div>
      )}

      <BottomTimeline
        media={media}
        duration={duration}
        sprite={sprite}
        fps={fps}
        cursorTime={cursorTime}
        onSeek={seek}
        captureCurrent={isVideoMode ? captureCurrent : undefined}
        togglePlay={isVideoMode ? togglePlay : undefined}
        isPlaying={isPlaying}
        busy={busy}
        setBusy={setBusy}
        setProgress={setProgress}
      />
    </div>
  );
}
