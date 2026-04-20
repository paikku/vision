"use client";

import { useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import {
  evenlySpacedTimes,
  extractFrames,
  formatTime,
} from "@/lib/media";

export function VideoFramePicker() {
  const media = useStore((s) => s.media);
  const addFrames = useStore((s) => s.addFrames);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(media?.duration ?? 0);
  const [interval, setInterval] = useState(8);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  useEffect(() => {
    setTime(0);
    setDuration(media?.duration ?? 0);
  }, [media?.id, media?.duration]);

  if (!media || media.kind !== "video") return null;

  const captureCurrent = async () => {
    setBusy(true);
    try {
      const frames = await extractFrames(media, { times: [time] });
      addFrames(frames);
    } finally {
      setBusy(false);
    }
  };

  const captureEvenly = async () => {
    const times = evenlySpacedTimes(duration, interval);
    setBusy(true);
    setProgress({ done: 0, total: times.length });
    try {
      const frames = await extractFrames(media, {
        times,
        onProgress: (done, total) => setProgress({ done, total }),
      });
      addFrames(frames);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <div className="flex flex-col gap-3 border-b border-[var(--color-line)] bg-[var(--color-surface)] p-3">
      <div className="relative overflow-hidden rounded-md bg-black">
        <video
          ref={videoRef}
          src={media.url}
          className="h-32 w-full object-contain"
          muted
          playsInline
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
          onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        />
      </div>
      <div className="flex items-center gap-2 text-xs text-[var(--color-muted)]">
        <button
          type="button"
          onClick={() => {
            const v = videoRef.current;
            if (!v) return;
            if (v.paused) void v.play();
            else v.pause();
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

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void captureCurrent()}
          className="rounded-md bg-[var(--color-accent)] px-3 py-2 text-sm font-medium text-black disabled:opacity-50"
        >
          Capture this frame
        </button>
        <div className="flex items-center gap-2 rounded-md border border-[var(--color-line)] px-2 py-1 text-xs text-[var(--color-muted)]">
          <span>every</span>
          <input
            type="number"
            min={1}
            max={64}
            value={interval}
            onChange={(e) => setInterval(Math.max(1, Number(e.target.value) || 1))}
            className="w-12 rounded bg-[var(--color-surface-2)] px-1 py-0.5 text-center text-[var(--color-text)] outline-none"
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => void captureEvenly()}
            className="ml-auto rounded bg-[var(--color-surface-2)] px-2 py-1 text-[var(--color-text)] hover:bg-[var(--color-line)] disabled:opacity-50"
          >
            Sample
          </button>
        </div>
      </div>

      {progress && (
        <div className="text-xs text-[var(--color-muted)]">
          extracting {progress.done}/{progress.total}…
        </div>
      )}
    </div>
  );
}
