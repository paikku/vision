"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { selectVisibleFrames, useStore } from "@/lib/store";
import { extractFrames, formatTime, type VideoSprite } from "../service/capture";
import type { MediaSource } from "../types";

const HANDLE_HIT_PX = 8;

const BTN_BASE =
  "rounded-md border px-2.5 py-1 text-xs font-medium transition disabled:opacity-40 disabled:cursor-not-allowed";
const BTN_DEFAULT = `${BTN_BASE} border-[var(--color-line)] bg-[var(--color-surface-2)] text-[var(--color-text)] hover:bg-[var(--color-line)]`;
const BTN_PRIMARY = `${BTN_BASE} border-transparent bg-[var(--color-accent)] text-black hover:opacity-90`;
const BTN_DANGER = `${BTN_BASE} border-red-500/40 bg-red-500/10 text-red-400 hover:bg-red-500/20`;

export type CaptureProgress = { done: number; total: number } | null;

export type BottomTimelineProps = {
  media: MediaSource;
  duration: number;
  sprite: VideoSprite | null;
  fps: number | null;
  /** Cursor position to indicate on the timeline. video mode: video.currentTime; frame mode: active frame timestamp. */
  cursorTime: number | null;
  /** Click/drag-to-seek handler. Omit in modes without a playable surface. */
  onSeek?: (t: number) => void;
  /** Capture-current-frame action (video mode only). */
  captureCurrent?: () => Promise<void>;
  /** Toggle playback (video mode only). */
  togglePlay?: () => void;
  /** Whether playback is currently running (video mode only). */
  isPlaying?: boolean;
  busy: boolean;
  setBusy: (v: boolean) => void;
};

type DragMode = "start" | "end" | "translate";

export function BottomTimeline({
  media,
  duration,
  sprite,
  fps,
  cursorTime,
  onSeek,
  captureCurrent,
  togglePlay,
  isPlaying,
  busy,
  setBusy,
}: BottomTimelineProps) {
  const frames = useStore((s) => s.frames);
  const annotations = useStore((s) => s.annotations);
  const exceptedFrameIds = useStore((s) => s.exceptedFrameIds);
  const frameSortOrder = useStore((s) => s.frameSortOrder);
  const unlabeledOnly = useStore((s) => s.unlabeledOnly);
  const rangeFilterEnabled = useStore((s) => s.rangeFilterEnabled);
  const frameRange = useStore((s) => s.frameRange);
  const setFrameRange = useStore((s) => s.setFrameRange);
  const activeFrameId = useStore((s) => s.activeFrameId);
  const addFrames = useStore((s) => s.addFrames);
  const removeFrame = useStore((s) => s.removeFrame);

  const [intervalSec, setIntervalSec] = useState(1);
  const [intervalDraft, setIntervalDraft] = useState("1.000");
  const [progress, setProgress] = useState<CaptureProgress>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Drag refs.
  const seekDragRef = useRef(false);
  const dragModeRef = useRef<DragMode | null>(null);
  const dragOriginRef = useRef<{
    pointerTime: number;
    range: { start: number; end: number };
  } | null>(null);

  // 3-color frame markers: visible-after-filter, filtered-out, active.
  const visibleFrameIds = useMemo(() => {
    const set = new Set<string>();
    for (const f of selectVisibleFrames({
      frames,
      annotations,
      exceptedFrameIds,
      frameSortOrder,
      unlabeledOnly,
      rangeFilterEnabled,
      frameRange,
    })) {
      set.add(f.id);
    }
    return set;
  }, [
    frames,
    annotations,
    exceptedFrameIds,
    frameSortOrder,
    unlabeledOnly,
    rangeFilterEnabled,
    frameRange,
  ]);

  const frameMarkers = useMemo(() => {
    if (!duration) return [];
    return frames
      .filter((f) => typeof f.timestamp === "number")
      .map((f) => ({
        id: f.id,
        left: Math.min(100, Math.max(0, ((f.timestamp ?? 0) / duration) * 100)),
        active: f.id === activeFrameId,
        visible: visibleFrameIds.has(f.id),
      }));
  }, [frames, duration, activeFrameId, visibleFrameIds]);

  const framesInRange = useMemo(() => {
    if (!frameRange) return [];
    return frames.filter(
      (f) =>
        typeof f.timestamp === "number" &&
        (f.timestamp as number) >= frameRange.start &&
        (f.timestamp as number) <= frameRange.end,
    );
  }, [frames, frameRange]);

  const span = frameRange ? Math.max(0, frameRange.end - frameRange.start) : 0;
  const minInterval = fps && fps > 0 ? 1 / fps : 0.001;
  const maxInterval = span > 0 ? span : minInterval;
  const clampedInterval = Math.min(
    maxInterval,
    Math.max(minInterval, intervalSec),
  );
  const sampleCount = span > 0 ? Math.floor(span / clampedInterval) : 0;

  // Sync the input draft when the committed value changes from the outside
  // (e.g. clamp on bounds change). Typing locally only updates the draft.
  useEffect(() => {
    setIntervalDraft(intervalSec.toFixed(3));
  }, [intervalSec]);

  const commitInterval = useCallback(() => {
    const v = parseFloat(intervalDraft);
    if (!Number.isFinite(v)) {
      setIntervalDraft(intervalSec.toFixed(3));
      return;
    }
    const next = Math.max(minInterval, Math.min(maxInterval, v));
    setIntervalSec(next);
    setIntervalDraft(next.toFixed(3));
  }, [intervalDraft, intervalSec, maxInterval, minInterval]);

  const ratioFromX = useCallback((clientX: number, el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  }, []);

  // -------------------- range track interactions --------------------

  const onRangePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!duration || !frameRange) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      const t = ratioFromX(e.clientX, e.currentTarget) * duration;
      const handleProx =
        (HANDLE_HIT_PX / e.currentTarget.getBoundingClientRect().width) * duration;

      let mode: DragMode;
      if (Math.abs(t - frameRange.start) < handleProx) mode = "start";
      else if (Math.abs(t - frameRange.end) < handleProx) mode = "end";
      else mode = "translate";

      dragModeRef.current = mode;
      dragOriginRef.current = { pointerTime: t, range: { ...frameRange } };
    },
    [duration, frameRange, ratioFromX],
  );

  const onRangePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragModeRef.current || !dragOriginRef.current || !duration) return;
      const t = ratioFromX(e.clientX, e.currentTarget) * duration;
      const mode = dragModeRef.current;
      const origin = dragOriginRef.current;

      if (mode === "start") {
        setFrameRange({
          start: Math.min(Math.max(0, t), origin.range.end),
          end: origin.range.end,
        });
      } else if (mode === "end") {
        setFrameRange({
          start: origin.range.start,
          end: Math.max(Math.min(duration, t), origin.range.start),
        });
      } else {
        const delta = t - origin.pointerTime;
        const width = origin.range.end - origin.range.start;
        let nextStart = origin.range.start + delta;
        if (nextStart < 0) nextStart = 0;
        if (nextStart + width > duration) nextStart = duration - width;
        setFrameRange({ start: nextStart, end: nextStart + width });
      }
    },
    [duration, ratioFromX, setFrameRange],
  );

  const onRangePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      dragModeRef.current = null;
      dragOriginRef.current = null;
    },
    [],
  );

  // -------------------- preview track interactions --------------------

  const onPreviewPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!onSeek || !duration) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      seekDragRef.current = true;
      onSeek(ratioFromX(e.clientX, e.currentTarget) * duration);
    },
    [duration, onSeek, ratioFromX],
  );

  const onPreviewPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (seekDragRef.current && onSeek && duration) {
        onSeek(ratioFromX(e.clientX, e.currentTarget) * duration);
      }
    },
    [duration, onSeek, ratioFromX],
  );

  const onPreviewPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      seekDragRef.current = false;
    },
    [],
  );

  // -------------------- actions --------------------

  const captureRangeEvenly = useCallback(async () => {
    if (!frameRange || media.kind !== "video") return;
    const sp = frameRange.end - frameRange.start;
    if (sp <= 0) return;
    const cnt = Math.floor(sp / clampedInterval);
    if (cnt <= 0) return;
    const times: number[] = [];
    for (let i = 0; i < cnt; i++) {
      times.push(frameRange.start + (i + 0.5) * clampedInterval);
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setProgress({ done: 0, total: times.length });
    try {
      await extractFrames(media, {
        times,
        signal: controller.signal,
        onProgress: (done, total) => setProgress({ done, total }),
        // Stream each frame into the store immediately so the strip and
        // markers update live as encoding progresses.
        onFrame: (f) => addFrames([f]),
      });
    } finally {
      abortRef.current = null;
      setBusy(false);
      setProgress(null);
    }
  }, [addFrames, clampedInterval, frameRange, media, setBusy]);

  const cancelExtraction = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const removeRangeFrames = useCallback(() => {
    if (framesInRange.length === 0) return;
    if (!frameRange) return;
    const ok = window.confirm(
      `현재 범위(${formatTime(frameRange.start)} ~ ${formatTime(frameRange.end)})에 있는 프레임 ${framesInRange.length}개를 삭제할까요?`,
    );
    if (!ok) return;
    for (const f of framesInRange) removeFrame(f.id);
  }, [frameRange, framesInRange, removeFrame]);

  const resetRange = useCallback(() => {
    setFrameRange({ start: 0, end: duration });
  }, [duration, setFrameRange]);

  const tileCount = sprite?.timestamps.length ?? 0;

  // -------------------- render --------------------

  return (
    <div className="space-y-2 border-t border-[var(--color-line)] bg-[var(--color-surface)] p-2">
      {/* Sprite preview track — doubles as the playback scrubber. */}
      <div
        className={[
          "relative h-10 overflow-hidden rounded-md border border-[var(--color-line)] select-none",
          onSeek ? "cursor-pointer" : "cursor-default",
        ].join(" ")}
        onPointerDown={onPreviewPointerDown}
        onPointerMove={onPreviewPointerMove}
        onPointerUp={onPreviewPointerUp}
        onPointerCancel={onPreviewPointerUp}
      >
        <div className="absolute inset-0 overflow-hidden rounded-md">
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
          {cursorTime !== null && duration > 0 && (
            <div
              className="absolute inset-y-0 w-0.5 bg-[var(--color-accent)]"
              style={{ left: `${(cursorTime / duration) * 100}%` }}
            />
          )}
          {frameMarkers.map((m) => {
            const color = m.active
              ? "bg-[var(--color-accent)]"
              : m.visible
              ? "bg-amber-300"
              : "bg-zinc-500/70";
            const height = m.active ? "h-3" : "h-2";
            return (
              <span
                key={m.id}
                className={`absolute bottom-0.5 w-0.5 ${height} ${color}`}
                style={{ left: `${m.left}%` }}
              />
            );
          })}
        </div>
      </div>

      {/* Range track */}
      <div
        onPointerDown={onRangePointerDown}
        onPointerMove={onRangePointerMove}
        onPointerUp={onRangePointerUp}
        onPointerCancel={onRangePointerUp}
        className="relative h-4 overflow-visible rounded-sm border border-[var(--color-line)] bg-[var(--color-surface-2)]"
        title="핸들 = 시작/끝 조절 · 본문/빈영역 드래그 = 범위 이동"
      >
        {frameRange && duration > 0 && (
          <>
            <div
              className="absolute inset-y-0 cursor-grab bg-[var(--color-accent)]/30 active:cursor-grabbing"
              style={{
                left: `${(frameRange.start / duration) * 100}%`,
                width: `${((frameRange.end - frameRange.start) / duration) * 100}%`,
              }}
            />
            <div
              className="absolute inset-y-[-2px] w-1.5 -translate-x-1/2 cursor-ew-resize rounded-sm bg-[var(--color-accent)]"
              style={{ left: `${(frameRange.start / duration) * 100}%` }}
            />
            <div
              className="absolute inset-y-[-2px] w-1.5 -translate-x-1/2 cursor-ew-resize rounded-sm bg-[var(--color-accent)]"
              style={{ left: `${(frameRange.end / duration) * 100}%` }}
            />
          </>
        )}
      </div>

      {/* Extraction progress + stop button */}
      {progress && (
        <div className="flex items-center gap-2 text-[11px] text-[var(--color-muted)]">
          <span className="tabular-nums">
            extracting frames {progress.done}/{progress.total}…
          </span>
          <button
            type="button"
            onClick={cancelExtraction}
            className={BTN_DEFAULT}
            title="여기까지 만들어진 프레임만 저장하고 중단"
          >
            중지
          </button>
        </div>
      )}

      {/* Action row — single line. Buttons share the same shape/padding/font. */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {togglePlay && (
          <button
            type="button"
            onClick={togglePlay}
            className={BTN_DEFAULT}
            title="재생 / 정지 (Space)"
          >
            {isPlaying ? "⏸ 정지" : "▶ 재생"}
          </button>
        )}
        <span className="tabular-nums text-[11px] text-[var(--color-muted)]">
          {formatTime(cursorTime ?? 0)} / {formatTime(duration)}
        </span>
        <span className="tabular-nums text-[11px] text-[var(--color-muted)]">
          {frameRange
            ? `· 범위 ${formatTime(frameRange.start)}~${formatTime(frameRange.end)} (${span.toFixed(2)}s)`
            : ""}
        </span>

        <span className="mx-1 h-4 w-px bg-[var(--color-line)]" />

        <button
          type="button"
          onClick={resetRange}
          disabled={!duration}
          className={BTN_DEFAULT}
          title="범위를 전체 [0, duration]로 초기화"
        >
          초기화
        </button>
        {captureCurrent && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void captureCurrent()}
            className={BTN_PRIMARY}
            title="현재 프레임을 캡쳐 (C)"
          >
            현재 캡쳐
          </button>
        )}

        <div className="flex items-center gap-1.5 rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)] px-2 py-1 text-[var(--color-text)]">
          <span className="text-[11px] text-[var(--color-muted)]">N초</span>
          <input
            type="number"
            min={minInterval}
            max={maxInterval}
            step={minInterval}
            value={intervalDraft}
            onChange={(e) => setIntervalDraft(e.target.value)}
            onBlur={commitInterval}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.currentTarget.blur();
              } else if (e.key === "Escape") {
                setIntervalDraft(intervalSec.toFixed(3));
                e.currentTarget.blur();
              }
            }}
            className="w-16 bg-transparent text-center tabular-nums outline-none"
          />
          <span className="whitespace-nowrap text-[11px] text-[var(--color-muted)]">
            ({minInterval.toFixed(3)}~{maxInterval.toFixed(2)}s · {sampleCount}개)
          </span>
        </div>
        <button
          type="button"
          disabled={busy || sampleCount <= 0}
          onClick={() => void captureRangeEvenly()}
          className={BTN_PRIMARY}
        >
          균등캡쳐
        </button>

        <button
          type="button"
          disabled={framesInRange.length === 0}
          onClick={removeRangeFrames}
          className={BTN_DANGER}
        >
          범위 {framesInRange.length}개 삭제
        </button>
      </div>
    </div>
  );
}
