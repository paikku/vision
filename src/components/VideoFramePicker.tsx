"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import {
  buildVideoSprite,
  captureFrameFromVideoElement,
  evenlySpacedTimes,
  extractFrames,
  formatTime,
  type VideoSprite,
} from "@/lib/media";
import { ExtractionPanel } from "./frame-extract/ExtractionPanel";

export function VideoFramePicker() {
  const media = useStore((s) => s.media);
  const frames = useStore((s) => s.frames);
  const addFrames = useStore((s) => s.addFrames);
  const setCenterViewMode = useStore((s) => s.setCenterViewMode);

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
  }, [media?.id, media?.duration]);

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
        const delta = e.shiftKey ? 5 : 1;
        const nextTime = Math.min(duration, video.currentTime + delta);
        video.currentTime = nextTime;
        setTime(nextTime);
      } else if (e.code === "ArrowLeft") {
        e.preventDefault();
        const delta = e.shiftKey ? 5 : 1;
        const nextTime = Math.max(0, video.currentTime - delta);
        video.currentTime = nextTime;
        setTime(nextTime);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [captureCurrent, duration, media, setCenterViewMode]);

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
      </div>

      <ExtractionPanel
        interval={interval}
        setInterval={setInterval}
        busy={busy}
        captureCurrent={captureCurrent}
        captureEvenly={captureEvenly}
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
        Shortcuts: Space play/pause · C capture · ←/→ seek 1s (Shift = 5s)
      </div>
    </div>
  );
}
