"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import {
  buildVideoSprite,
  captureFrameFromVideoElement,
  estimateVideoFps,
  evenlySpacedTimes,
  extractFrames,
  formatTime,
  type VideoSprite,
} from "../service/capture";
import { ExtractionPanel } from "./frame-extract/ExtractionPanel";

const STEP_MIN = 1 / 240; // hard floor in case fps detection returns absurdly high
const STEP_MAX = 5;       // ceiling for the user-input step
const SHIFT_MULTIPLIER = 5;

export function VideoFramePicker() {
  const media = useStore((s) => s.media);
  const frames = useStore((s) => s.frames);
  const addFrames = useStore((s) => s.addFrames);
  const setCenterViewMode = useStore((s) => s.setCenterViewMode);
  const removeFrame = useStore((s) => s.removeFrame);
  const frameRange = useStore((s) => s.frameRange);
  const setFrameRange = useStore((s) => s.setFrameRange);

  const videoRef = useRef<HTMLVideoElement>(null);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(media?.duration ?? 0);
  const [interval, setInterval] = useState(8);
  const [busy, setBusy] = useState(false);
  const [sampleProgress, setSampleProgress] = useState<{ done: number; total: number } | null>(null);
  const [spriteProgress, setSpriteProgress] = useState<{ done: number; total: number } | null>(null);
  const [sprite, setSprite] = useState<VideoSprite | null>(null);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState<number | null>(null);

  // FPS detection. `null` until detected; UI shows the auto-detected value
  // with a manual override slot so it is never blocking.
  const [fps, setFps] = useState<number | null>(null);
  const [fpsDetecting, setFpsDetecting] = useState(false);

  // User-tunable arrow-key step (seconds). Starts at "1 frame" once fps is
  // known, otherwise at 1s — same default as before.
  const [stepSec, setStepSec] = useState(1);
  const stepInitializedRef = useRef(false);

  // Range slim track interaction state.
  const rangeTrackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<null | "start" | "end" | "create">(null);
  const dragOriginRef = useRef<number>(0);

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

  const captureEvenly = useCallback(async () => {
    if (!media || media.kind !== "video") return;
    const times = evenlySpacedTimes(duration, interval);
    setBusy(true);
    setSampleProgress({ done: 0, total: times.length });
    try {
      const nextFrames = await extractFrames(media, {
        times,
        onProgress: (done, total) => setSampleProgress({ done, total }),
      });
      addFrames(nextFrames);
    } finally {
      setBusy(false);
      setSampleProgress(null);
    }
  }, [addFrames, duration, interval, media]);

  const extractInRange = useCallback(
    async (count: number) => {
      if (!media || media.kind !== "video" || !frameRange) return;
      const span = Math.max(0, frameRange.end - frameRange.start);
      if (span <= 0 || count <= 0) return;
      // evenlySpacedTimes(span, n) yields n interior points; offset by start.
      const times = evenlySpacedTimes(span, count).map((t) => t + frameRange.start);
      setBusy(true);
      setSampleProgress({ done: 0, total: times.length });
      try {
        const nextFrames = await extractFrames(media, {
          times,
          onProgress: (done, total) => setSampleProgress({ done, total }),
        });
        addFrames(nextFrames);
      } finally {
        setBusy(false);
        setSampleProgress(null);
      }
    },
    [addFrames, frameRange, media],
  );

  const captureRangeEvenly = useCallback((n: number) => extractInRange(n), [extractInRange]);
  const captureRangeMaxCount = useCallback((max: number) => extractInRange(max), [extractInRange]);

  const framesInRange = useMemo(() => {
    if (!frameRange) return [];
    return frames.filter(
      (f) =>
        typeof f.timestamp === "number" &&
        f.timestamp >= frameRange.start &&
        f.timestamp <= frameRange.end,
    );
  }, [frames, frameRange]);

  const removeRangeFrames = useCallback(() => {
    for (const f of framesInRange) removeFrame(f.id);
  }, [framesInRange, removeFrame]);

  const frameMarkers = useMemo(() => {
    if (!duration) return [];
    return frames
      .map((f) => f.timestamp)
      .filter((v): v is number => typeof v === "number")
      .map((t) => Math.min(100, Math.max(0, (t / duration) * 100)));
  }, [duration, frames]);

  useEffect(() => {
    setTime(0);
    setDuration(media?.duration ?? 0);
    setFps(null);
    setFpsDetecting(false);
    stepInitializedRef.current = false;
    setFrameRange(null);
  }, [media?.id, media?.duration, setFrameRange]);

  // Auto-detect fps in the background once metadata is loaded.
  useEffect(() => {
    if (!media || media.kind !== "video") return;
    const video = videoRef.current;
    if (!video) return;

    let canceled = false;
    const run = async () => {
      // Wait for metadata if not ready yet.
      if (video.readyState < 1) {
        await new Promise<void>((resolve) => {
          const ok = () => { video.removeEventListener("loadedmetadata", ok); resolve(); };
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

  useEffect(() => {
    if (!media || media.kind !== "video") return;

    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      ) {
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
        const nextTime = Math.min(duration, video.currentTime + delta);
        video.currentTime = nextTime;
        setTime(nextTime);
      } else if (e.code === "ArrowLeft") {
        e.preventDefault();
        const delta = e.shiftKey ? stepSec * SHIFT_MULTIPLIER : stepSec;
        const nextTime = Math.max(0, video.currentTime - delta);
        video.currentTime = nextTime;
        setTime(nextTime);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [captureCurrent, duration, media, setCenterViewMode, stepSec]);

  // ---- range track drag handlers --------------------------------------

  const ratioFromEvent = useCallback((clientX: number): number => {
    const el = rangeTrackRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  }, []);

  const onRangePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!duration) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      const t = ratioFromEvent(e.clientX) * duration;

      // Hit test handle proximity (≈8px in normalized space).
      const handleProx = (8 / e.currentTarget.getBoundingClientRect().width) * duration;
      if (frameRange && Math.abs(t - frameRange.start) < handleProx) {
        dragRef.current = "start";
      } else if (frameRange && Math.abs(t - frameRange.end) < handleProx) {
        dragRef.current = "end";
      } else {
        // Start a new range from this point.
        dragRef.current = "create";
        dragOriginRef.current = t;
        setFrameRange({ start: t, end: t });
      }
    },
    [duration, frameRange, ratioFromEvent, setFrameRange],
  );

  const onRangePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragRef.current || !duration) return;
      const t = ratioFromEvent(e.clientX) * duration;
      const mode = dragRef.current;
      if (mode === "create") {
        const a = dragOriginRef.current;
        const b = t;
        setFrameRange({ start: Math.min(a, b), end: Math.max(a, b) });
        return;
      }
      if (!frameRange) return;
      if (mode === "start") {
        setFrameRange({
          start: Math.min(t, frameRange.end),
          end: frameRange.end,
        });
      } else if (mode === "end") {
        setFrameRange({
          start: frameRange.start,
          end: Math.max(t, frameRange.start),
        });
      }
    },
    [duration, frameRange, ratioFromEvent, setFrameRange],
  );

  const onRangePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      // If user just clicked without drag, the start==end range is meaningless.
      if (dragRef.current === "create" && frameRange && frameRange.end - frameRange.start < 1e-3) {
        setFrameRange(null);
      }
      dragRef.current = null;
    },
    [frameRange, setFrameRange],
  );

  // ---------------------------------------------------------------------

  if (!media || media.kind !== "video") return null;

  const previewTime = hoverTime ?? time;
  const spriteIndex = sprite
    ? (() => {
        const idx = sprite.timestamps.findIndex((ts, i, arr) => {
          const next = arr[i + 1] ?? Infinity;
          return previewTime >= ts && previewTime < next;
        });
        if (idx >= 0) return idx;
        return previewTime < (sprite.timestamps[0] ?? 0)
          ? 0
          : sprite.timestamps.length - 1;
      })()
    : -1;

  const previewCol = sprite && spriteIndex >= 0 ? spriteIndex % sprite.columns : 0;
  const previewRow = sprite && spriteIndex >= 0 ? Math.floor(spriteIndex / sprite.columns) : 0;
  const tileCount = sprite?.timestamps.length ?? 0;

  const stepMin = fps ? Math.max(STEP_MIN, 1 / fps) : 0.01;
  const stepMaxGuide = 1.0;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 bg-[var(--color-surface)] p-3">
      <div className="relative min-h-[280px] flex-1 overflow-hidden rounded-md bg-black">
        <video
          ref={videoRef}
          src={media.url}
          className="h-full w-full object-contain"
          muted
          playsInline
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
          onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        />
      </div>

      <div className="space-y-2">
        <div
          className="relative h-10 overflow-hidden rounded-md border border-[var(--color-line)]"
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
            setHoverTime(ratio * duration);
            setHoverX(e.clientX - rect.left);
          }}
          onMouseLeave={() => {
            setHoverTime(null);
            setHoverX(null);
          }}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
            const next = ratio * duration;
            setTime(next);
            if (videoRef.current) videoRef.current.currentTime = next;
          }}
        >
          {sprite && tileCount > 0 && (
            <div className="absolute inset-0 flex">
              {sprite.timestamps.map((_, idx) => {
                const col = idx % sprite.columns;
                const row = Math.floor(idx / sprite.columns);
                return (
                  <div
                    key={`tile-${idx}`}
                    className="h-full"
                    style={{
                      width: `${100 / tileCount}%`,
                      backgroundImage: `url(${sprite.url})`,
                      backgroundPosition: `${-col * sprite.cellWidth}px ${-row * sprite.cellHeight}px`,
                      backgroundSize: `${sprite.width}px ${sprite.height}px`,
                      backgroundRepeat: "no-repeat",
                    }}
                  />
                );
              })}
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/45 to-transparent" />
          <div
            className="absolute inset-y-0 w-0.5 bg-[var(--color-accent)]"
            style={{ left: `${duration ? (time / duration) * 100 : 0}%` }}
          />
          {frameMarkers.map((left, i) => (
            <span
              key={`${left}-${i}`}
              className="absolute bottom-0.5 h-2 w-0.5 bg-amber-300"
              style={{ left: `${left}%` }}
            />
          ))}
          {sprite && hoverX !== null && hoverTime !== null && spriteIndex >= 0 && (
            <div
              className="pointer-events-none absolute bottom-full mb-1 overflow-hidden rounded border border-[var(--color-line)] bg-black"
              style={{
                left: `clamp(0px, ${hoverX - sprite.cellWidth / 2}px, calc(100% - ${sprite.cellWidth}px))`,
                width: sprite.cellWidth,
              }}
            >
              <div
                style={{
                  width: sprite.cellWidth,
                  height: sprite.cellHeight,
                  backgroundImage: `url(${sprite.url})`,
                  backgroundPosition: `${-previewCol * sprite.cellWidth}px ${-previewRow * sprite.cellHeight}px`,
                  backgroundSize: `${sprite.width}px ${sprite.height}px`,
                }}
              />
              <div className="px-1 py-0.5 text-center text-[10px] text-white">{formatTime(hoverTime)}</div>
            </div>
          )}
        </div>

        {/* Slim range track. Drag to create/move start/end handles. */}
        <div className="flex items-center gap-2">
          <span className="w-10 shrink-0 text-[10px] text-[var(--color-muted)]">Range</span>
          <div
            ref={rangeTrackRef}
            onPointerDown={onRangePointerDown}
            onPointerMove={onRangePointerMove}
            onPointerUp={onRangePointerUp}
            onPointerCancel={onRangePointerUp}
            className="relative h-4 flex-1 cursor-crosshair overflow-visible rounded-sm bg-[var(--color-surface-2)] border border-[var(--color-line)]"
            title="드래그하여 범위 설정 · 핸들을 드래그하여 조절"
          >
            {frameRange && duration > 0 && (
              <>
                <div
                  className="absolute inset-y-0 bg-[var(--color-accent)]/30"
                  style={{
                    left: `${(frameRange.start / duration) * 100}%`,
                    width: `${((frameRange.end - frameRange.start) / duration) * 100}%`,
                  }}
                />
                <div
                  className="absolute inset-y-0 w-1 -translate-x-1/2 cursor-ew-resize bg-[var(--color-accent)]"
                  style={{ left: `${(frameRange.start / duration) * 100}%` }}
                />
                <div
                  className="absolute inset-y-0 w-1 -translate-x-1/2 cursor-ew-resize bg-[var(--color-accent)]"
                  style={{ left: `${(frameRange.end / duration) * 100}%` }}
                />
              </>
            )}
          </div>
          {frameRange ? (
            <button
              type="button"
              onClick={() => setFrameRange(null)}
              className="rounded border border-[var(--color-line)] px-1.5 py-0.5 text-[10px] text-[var(--color-muted)] hover:text-[var(--color-text)]"
              title="범위 해제"
            >
              해제
            </button>
          ) : (
            <span className="text-[10px] text-[var(--color-muted)]">미설정</span>
          )}
        </div>

        {frameRange && (
          <div className="flex items-center gap-2 text-[10px] text-[var(--color-muted)]">
            <button
              type="button"
              onClick={() => frameRange && setFrameRange({ start: time, end: Math.max(time, frameRange.end) })}
              className="rounded border border-[var(--color-line)] px-1.5 py-0.5 hover:text-[var(--color-text)]"
            >
              현재시간 → 시작
            </button>
            <button
              type="button"
              onClick={() => frameRange && setFrameRange({ start: Math.min(time, frameRange.start), end: time })}
              className="rounded border border-[var(--color-line)] px-1.5 py-0.5 hover:text-[var(--color-text)]"
            >
              현재시간 → 끝
            </button>
            <span className="ml-auto tabular-nums">
              {formatTime(frameRange.start)} ~ {formatTime(frameRange.end)} ({(frameRange.end - frameRange.start).toFixed(2)}s)
            </span>
          </div>
        )}

        <div className="flex items-center gap-2 text-xs text-[var(--color-muted)]">
          <button
            type="button"
            onClick={() => {
              const v = videoRef.current;
              if (!v) return;
              if (v.paused) {
                setCenterViewMode("video");
                void v.play();
              } else v.pause();
            }}
            className="rounded border border-[var(--color-line)] px-2 py-1 text-[var(--color-text)] hover:border-[var(--color-accent)]"
          >
            play / pause
          </button>
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.05}
            value={time}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              setTime(v);
              if (videoRef.current) videoRef.current.currentTime = v;
            }}
            className="flex-1 accent-[var(--color-accent)]"
          />
          <span className="tabular-nums">
            {formatTime(time)} / {formatTime(duration)}
          </span>
        </div>

        {/* Arrow-key step + fps guide */}
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
              if (Number.isFinite(v)) setStepSec(Math.max(STEP_MIN, Math.min(STEP_MAX, v)));
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
            {fpsDetecting ? "fps 추정중…" : fps ? `${fps} fps · 가이드 ${stepMin.toFixed(3)}~${stepMaxGuide.toFixed(2)}s` : "fps 추정 실패 — 직접 입력"}
          </span>
        </div>
      </div>

      <ExtractionPanel
        interval={interval}
        setInterval={setInterval}
        busy={busy}
        captureCurrent={captureCurrent}
        captureEvenly={captureEvenly}
        range={frameRange}
        captureRangeEvenly={captureRangeEvenly}
        captureRangeMaxCount={captureRangeMaxCount}
        removeRangeFrames={removeRangeFrames}
        rangeFrameCount={framesInRange.length}
      />

      {spriteProgress && (
        <div className="text-xs text-[var(--color-muted)]">
          building timeline {spriteProgress.done}/{spriteProgress.total}…
        </div>
      )}
      {sampleProgress && (
        <div className="text-xs text-[var(--color-muted)]">
          extracting frames {sampleProgress.done}/{sampleProgress.total}…
        </div>
      )}
      <div className="text-[10px] text-[var(--color-muted)]">
        Shortcuts: Space play/pause · C capture · ←/→ step (Shift = ×{SHIFT_MULTIPLIER})
      </div>
    </div>
  );
}
