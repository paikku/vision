"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { selectVisibleFrames, useStore } from "@/lib/store";
import { extractFrames, formatTime, type VideoSprite } from "../service/capture";
import type { MediaSource } from "../types";

const HOVER_POPUP_WIDTH = 480;
const HANDLE_HIT_PX = 8;

export type CaptureProgress = { done: number; total: number } | null;

export type BottomTimelineProps = {
  media: MediaSource;
  duration: number;
  sprite: VideoSprite | null;
  fps: number | null;
  /** Cursor position to indicate on the timeline. video mode: video.currentTime; frame mode: active frame timestamp. */
  cursorTime: number | null;
  /** Optional click-to-seek handler. Omit in modes without a playable surface. */
  onSeek?: (t: number) => void;
  /** Capture-current-frame action (video mode only). */
  captureCurrent?: () => Promise<void>;
  busy: boolean;
  setBusy: (v: boolean) => void;
  setProgress: (p: CaptureProgress) => void;
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
  busy,
  setBusy,
  setProgress,
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

  const previewRef = useRef<HTMLDivElement>(null);
  const rangeTrackRef = useRef<HTMLDivElement>(null);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const [intervalSec, setIntervalSec] = useState(1);

  // Range drag state.
  const dragModeRef = useRef<DragMode | null>(null);
  const dragOriginRef = useRef<{ pointerTime: number; range: { start: number; end: number } } | null>(null);

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
  }, [frames, annotations, exceptedFrameIds, frameSortOrder, unlabeledOnly, rangeFilterEnabled, frameRange]);

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

  const onRangePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    dragModeRef.current = null;
    dragOriginRef.current = null;
  }, []);

  // -------------------- preview track interactions --------------------

  const onPreviewMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    setHoverTime(ratio * duration);
    setHoverX(e.clientX - rect.left);
  }, [duration]);

  const onPreviewLeave = useCallback(() => {
    setHoverTime(null);
    setHoverX(null);
  }, []);

  const onPreviewClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!onSeek) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      onSeek(ratio * duration);
    },
    [duration, onSeek],
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
    setBusy(true);
    setProgress({ done: 0, total: times.length });
    try {
      const next = await extractFrames(media, {
        times,
        onProgress: (done, total) => setProgress({ done, total }),
      });
      addFrames(next);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, [addFrames, clampedInterval, frameRange, media, setBusy, setProgress]);

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

  // -------------------- preview tile lookup --------------------

  const previewTime = hoverTime ?? cursorTime ?? 0;
  const spriteIndex = sprite
    ? (() => {
        const idx = sprite.timestamps.findIndex((ts, i, arr) => {
          const next = arr[i + 1] ?? Infinity;
          return previewTime >= ts && previewTime < next;
        });
        if (idx >= 0) return idx;
        return previewTime < (sprite.timestamps[0] ?? 0) ? 0 : sprite.timestamps.length - 1;
      })()
    : -1;
  const previewCol = sprite && spriteIndex >= 0 ? spriteIndex % sprite.columns : 0;
  const previewRow = sprite && spriteIndex >= 0 ? Math.floor(spriteIndex / sprite.columns) : 0;
  const tileCount = sprite?.timestamps.length ?? 0;

  const popupHeight = sprite ? Math.round((HOVER_POPUP_WIDTH * sprite.cellHeight) / sprite.cellWidth) : 0;
  const popupScale = sprite ? HOVER_POPUP_WIDTH / sprite.cellWidth : 1;

  // -------------------- render --------------------

  return (
    <div className="space-y-2 border-t border-[var(--color-line)] bg-[var(--color-surface)] p-2">
      {/* Sprite preview track */}
      <div
        ref={previewRef}
        className={[
          "relative h-10 overflow-visible rounded-md border border-[var(--color-line)]",
          onSeek ? "cursor-pointer" : "cursor-default",
        ].join(" ")}
        onMouseMove={onPreviewMove}
        onMouseLeave={onPreviewLeave}
        onClick={onPreviewClick}
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
        {sprite && hoverX !== null && hoverTime !== null && spriteIndex >= 0 && (
          <div
            className="pointer-events-none absolute bottom-full z-30 mb-2 overflow-hidden rounded border border-[var(--color-line)] bg-black shadow-lg"
            style={{
              left: `clamp(0px, ${hoverX - HOVER_POPUP_WIDTH / 2}px, calc(100% - ${HOVER_POPUP_WIDTH}px))`,
              width: HOVER_POPUP_WIDTH,
            }}
          >
            <div
              style={{
                width: HOVER_POPUP_WIDTH,
                height: popupHeight,
                backgroundImage: `url(${sprite.url})`,
                backgroundPosition: `${-previewCol * sprite.cellWidth * popupScale}px ${-previewRow * sprite.cellHeight * popupScale}px`,
                backgroundSize: `${sprite.width * popupScale}px ${sprite.height * popupScale}px`,
                backgroundRepeat: "no-repeat",
                imageRendering: "auto",
              }}
            />
            <div className="px-1 py-0.5 text-center text-[11px] text-white tabular-nums">
              {formatTime(hoverTime)}
            </div>
          </div>
        )}
      </div>

      {/* Range track */}
      <div
        ref={rangeTrackRef}
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

      {/* Action row */}
      <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-muted)]">
        {frameRange && (
          <span className="tabular-nums text-[10px]">
            {formatTime(frameRange.start)} ~ {formatTime(frameRange.end)} ({span.toFixed(2)}s)
          </span>
        )}
        <button
          type="button"
          onClick={resetRange}
          disabled={!duration}
          className="rounded border border-[var(--color-line)] px-2 py-1 hover:text-[var(--color-text)] disabled:opacity-40"
          title="범위를 전체 [0, duration]로 초기화"
        >
          초기화
        </button>
        {captureCurrent && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void captureCurrent()}
            className="rounded-md bg-[var(--color-accent)] px-2 py-1 font-medium text-black disabled:opacity-50"
            title="현재 프레임을 캡쳐 (C)"
          >
            현재 캡쳐
          </button>
        )}
        <div className="flex items-center gap-1 rounded border border-[var(--color-line)] px-1.5 py-0.5">
          <span>N초</span>
          <input
            type="number"
            min={minInterval}
            max={maxInterval}
            step={minInterval}
            value={Number(intervalSec.toFixed(3))}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              if (!Number.isFinite(v)) return;
              setIntervalSec(
                Math.max(minInterval, Math.min(maxInterval, v)),
              );
            }}
            className="w-20 rounded bg-[var(--color-surface-2)] px-1 py-0.5 text-center text-[var(--color-text)] tabular-nums outline-none"
          />
          <span className="text-[10px] tabular-nums">
            {minInterval.toFixed(3)}~{maxInterval.toFixed(2)}s · {sampleCount}개
          </span>
          <button
            type="button"
            disabled={busy || sampleCount <= 0}
            onClick={() => void captureRangeEvenly()}
            className="ml-1 rounded bg-[var(--color-surface-2)] px-2 py-1 text-[var(--color-text)] hover:bg-[var(--color-line)] disabled:opacity-50"
          >
            균등캡쳐
          </button>
        </div>
        <button
          type="button"
          disabled={framesInRange.length === 0}
          onClick={removeRangeFrames}
          className="rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-red-400 hover:bg-red-500/20 disabled:opacity-40"
        >
          범위 {framesInRange.length}개 삭제
        </button>
      </div>
    </div>
  );
}
