"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildVideoSprite,
  captureFrameFromVideoElement,
  estimateVideoFps,
  extractFrames,
  formatTime,
  type VideoSprite,
} from "@/features/media/service/capture";
import type { MediaSource } from "@/features/media/types";
import {
  deleteImage,
  imageBytesUrl,
  listImages,
} from "@/features/images/service/api";
import type { Image } from "@/features/images/types";
import {
  getResource,
  resourceSourceUrl,
} from "@/features/resources/service/api";
import { addImagesToResource } from "@/features/resources/service/api";
import type { Resource } from "@/features/resources/types";

const HANDLE_HIT_PX = 8;

const BTN_BASE =
  "rounded-md border px-2.5 py-1 text-xs font-medium transition disabled:opacity-40 disabled:cursor-not-allowed";
const BTN_DEFAULT = `${BTN_BASE} border-[var(--color-line)] bg-[var(--color-surface-2)] text-[var(--color-text)] hover:bg-[var(--color-line)]`;
const BTN_PRIMARY = `${BTN_BASE} border-transparent bg-[var(--color-accent)] text-black hover:opacity-90`;
const BTN_DANGER = `${BTN_BASE} border-red-500/40 bg-red-500/10 text-red-400 hover:bg-red-500/20`;

type DragMode = "start" | "end" | "translate";
type CaptureProgress = { done: number; total: number } | null;

type Range = { start: number; end: number };

export function FrameExtractionPage({
  projectId,
  resourceId,
}: {
  projectId: string;
  resourceId: string;
}) {
  const [resource, setResource] = useState<Resource | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [frames, setFrames] = useState<Image[]>([]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [fps, setFps] = useState<number | null>(null);
  const [sprite, setSprite] = useState<VideoSprite | null>(null);
  const [range, setRange] = useState<Range | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<CaptureProgress>(null);
  const [intervalSec, setIntervalSec] = useState(1);
  const [intervalDraft, setIntervalDraft] = useState("1.000");
  const [stepSec, setStepSec] = useState(0.1);
  const abortRef = useRef<AbortController | null>(null);

  // Build a MediaSource pointing at the server video URL. The capture
  // pipeline only needs `url` + `kind` + dimensions/duration; the in-memory
  // File is unavailable here (video lives on the server) so sprite building
  // falls back to evenly-spaced sampling automatically.
  const media: MediaSource | null = useMemo(() => {
    if (!resource || resource.type !== "video") return null;
    if (!resource.width || !resource.height) return null;
    return {
      id: resource.id,
      kind: "video",
      name: resource.name,
      url: resourceSourceUrl(projectId, resource.id),
      width: resource.width,
      height: resource.height,
      duration: resource.duration,
      ingestVia: resource.ingestVia,
    };
  }, [projectId, resource]);

  // ---------- load resource + existing frames ----------

  const reloadFrames = useCallback(async () => {
    const imgs = await listImages(projectId, {
      resourceId,
      source: "video_frame",
    });
    imgs.sort((a, b) => {
      const ta = a.videoFrameMeta?.timestamp ?? 0;
      const tb = b.videoFrameMeta?.timestamp ?? 0;
      return ta - tb;
    });
    setFrames(imgs);
  }, [projectId, resourceId]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await getResource(projectId, resourceId);
        if (!alive) return;
        if (r.type !== "video") {
          setError("이 Resource 는 비디오가 아닙니다.");
          setResource(r);
          return;
        }
        setResource(r);
        await reloadFrames();
      } catch (e) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : "Resource 로드 실패");
      }
    })();
    return () => {
      alive = false;
    };
  }, [projectId, resourceId, reloadFrames]);

  // ---------- video element wiring ----------

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onLoaded = () => {
      setDuration(v.duration || 0);
      if (v.duration) setRange({ start: 0, end: v.duration });
      // Try fps detection in the background; ignore failures.
      estimateVideoFps(v).then((f) => setFps(f)).catch(() => {});
    };
    const onTime = () => setCurrentTime(v.currentTime);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    v.addEventListener("loadedmetadata", onLoaded);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    return () => {
      v.removeEventListener("loadedmetadata", onLoaded);
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
    };
  }, [media?.url]);

  // ---------- sprite (built once) ----------

  useEffect(() => {
    if (!media || !duration) return;
    let cancelled = false;
    let url: string | null = null;
    buildVideoSprite(media, { maxFrames: 60, thumbWidth: 120 })
      .then((s) => {
        if (cancelled) {
          URL.revokeObjectURL(s.url);
          return;
        }
        url = s.url;
        setSprite(s);
      })
      .catch(() => {
        // Sprite is non-essential; the timeline still functions without it.
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [media, duration]);

  // ---------- timeline interactions ----------

  const span = range ? Math.max(0, range.end - range.start) : 0;
  const minInterval = fps && fps > 0 ? 1 / fps : 0.001;
  const maxInterval = span > 0 ? span : minInterval;
  const clampedInterval = Math.min(
    maxInterval,
    Math.max(minInterval, intervalSec),
  );
  const sampleCount = span > 0 ? Math.floor(span / clampedInterval) : 0;

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

  const seekDragRef = useRef(false);
  const dragModeRef = useRef<DragMode | null>(null);
  const dragOriginRef = useRef<{
    pointerTime: number;
    range: Range;
  } | null>(null);

  const seek = useCallback((t: number) => {
    const v = videoRef.current;
    if (!v) return;
    const clamped = Math.max(0, Math.min(duration || 0, t));
    v.currentTime = clamped;
  }, [duration]);

  const onPreviewPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!duration) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      seekDragRef.current = true;
      seek(ratioFromX(e.clientX, e.currentTarget) * duration);
    },
    [duration, ratioFromX, seek],
  );
  const onPreviewPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (seekDragRef.current && duration) {
        seek(ratioFromX(e.clientX, e.currentTarget) * duration);
      }
    },
    [duration, ratioFromX, seek],
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

  const onRangePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!duration || !range) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      const t = ratioFromX(e.clientX, e.currentTarget) * duration;
      const handleProx =
        (HANDLE_HIT_PX / e.currentTarget.getBoundingClientRect().width) * duration;
      let mode: DragMode;
      if (Math.abs(t - range.start) < handleProx) mode = "start";
      else if (Math.abs(t - range.end) < handleProx) mode = "end";
      else mode = "translate";
      dragModeRef.current = mode;
      dragOriginRef.current = { pointerTime: t, range: { ...range } };
    },
    [duration, range, ratioFromX],
  );
  const onRangePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragModeRef.current || !dragOriginRef.current || !duration) return;
      const t = ratioFromX(e.clientX, e.currentTarget) * duration;
      const mode = dragModeRef.current;
      const origin = dragOriginRef.current;
      if (mode === "start") {
        setRange({
          start: Math.min(Math.max(0, t), origin.range.end),
          end: origin.range.end,
        });
      } else if (mode === "end") {
        setRange({
          start: origin.range.start,
          end: Math.max(Math.min(duration, t), origin.range.start),
        });
      } else {
        const delta = t - origin.pointerTime;
        const width = origin.range.end - origin.range.start;
        let nextStart = origin.range.start + delta;
        if (nextStart < 0) nextStart = 0;
        if (nextStart + width > duration) nextStart = duration - width;
        setRange({ start: nextStart, end: nextStart + width });
      }
    },
    [duration, ratioFromX],
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

  // ---------- frame markers (existing extracted frames) ----------

  const frameMarkers = useMemo(() => {
    if (!duration) return [] as { id: string; left: number }[];
    return frames
      .filter((f) => typeof f.videoFrameMeta?.timestamp === "number")
      .map((f) => ({
        id: f.id,
        left: Math.min(
          100,
          Math.max(0, ((f.videoFrameMeta!.timestamp as number) / duration) * 100),
        ),
      }));
  }, [frames, duration]);

  const framesInRange = useMemo(() => {
    if (!range) return [];
    return frames.filter((f) => {
      const t = f.videoFrameMeta?.timestamp;
      if (typeof t !== "number") return false;
      return t >= range.start && t <= range.end;
    });
  }, [frames, range]);

  // ---------- capture / upload pipeline ----------

  const uploadFrame = useCallback(
    async (
      blob: Blob,
      ts: number,
      width: number,
      height: number,
    ): Promise<Image[]> => {
      const fileName = `frame-${ts.toFixed(3).replace(".", "_")}.jpg`;
      return addImagesToResource(projectId, resourceId, [
        {
          blob,
          fileName,
          width,
          height,
          timestamp: ts,
        },
      ]);
    },
    [projectId, resourceId],
  );

  const captureCurrent = useCallback(async () => {
    if (!media || !videoRef.current || busy) return;
    setBusy(true);
    setProgress(null);
    try {
      const f = await captureFrameFromVideoElement(media, videoRef.current);
      if (!f) return;
      const blob = await (await fetch(f.url)).blob();
      URL.revokeObjectURL(f.url);
      const [img] = await uploadFrame(blob, f.timestamp ?? 0, f.width, f.height);
      if (img) setFrames((prev) => mergeAndSortByTimestamp(prev, [img]));
    } catch (e) {
      setError(e instanceof Error ? e.message : "캡쳐 실패");
    } finally {
      setBusy(false);
    }
  }, [busy, media, uploadFrame]);

  const captureRangeEvenly = useCallback(async () => {
    if (!media || !range || busy) return;
    const sp = range.end - range.start;
    if (sp <= 0) return;
    const cnt = Math.floor(sp / clampedInterval);
    if (cnt <= 0) return;
    const times: number[] = [];
    for (let i = 0; i < cnt; i++) {
      times.push(range.start + (i + 0.5) * clampedInterval);
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
        onFrame: async (f) => {
          // Upload each frame as soon as it's encoded so the grid + markers
          // update progressively. Kick off the upload but don't block the
          // extractor on it — the next seek can run while this one uploads.
          try {
            const blob = await (await fetch(f.url)).blob();
            URL.revokeObjectURL(f.url);
            const [img] = await uploadFrame(
              blob,
              f.timestamp ?? 0,
              f.width,
              f.height,
            );
            if (img) {
              setFrames((prev) => mergeAndSortByTimestamp(prev, [img]));
            }
          } catch {
            // Best-effort: skip this frame.
          }
        },
      });
    } finally {
      abortRef.current = null;
      setBusy(false);
      setProgress(null);
    }
  }, [busy, clampedInterval, media, range, uploadFrame]);

  const cancelExtraction = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const removeRangeFrames = useCallback(async () => {
    if (framesInRange.length === 0 || !range) return;
    if (
      !confirm(
        `현재 범위(${formatTime(range.start)} ~ ${formatTime(range.end)})에 있는 프레임 ${framesInRange.length}개를 삭제할까요?`,
      )
    ) {
      return;
    }
    const ids = framesInRange.map((f) => f.id);
    setFrames((prev) => prev.filter((f) => !ids.includes(f.id)));
    await Promise.all(ids.map((id) => deleteImage(projectId, id))).catch(
      () => {},
    );
  }, [framesInRange, projectId, range]);

  const resetRange = useCallback(() => {
    if (duration) setRange({ start: 0, end: duration });
  }, [duration]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play();
    else v.pause();
  }, []);

  // ---------- keyboard shortcuts ----------

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
      } else if (e.key === "c" || e.key === "C") {
        e.preventDefault();
        void captureCurrent();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        seek(currentTime - stepSec * (e.shiftKey ? 5 : 1));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        seek(currentTime + stepSec * (e.shiftKey ? 5 : 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [captureCurrent, currentTime, seek, stepSec, togglePlay]);

  // ---------- render ----------

  const tileCount = sprite?.timestamps.length ?? 0;

  return (
    <div className="flex min-h-screen flex-col bg-[var(--color-bg)]">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-[var(--color-line)] bg-[var(--color-surface)] px-4">
        <Link
          href={`/projects/${projectId}`}
          className="text-xs text-[var(--color-muted)] hover:text-[var(--color-accent)]"
        >
          ← Media Library
        </Link>
        <div className="text-sm font-semibold tracking-tight">
          Frame Extraction · {resource?.name ?? "Loading…"}
        </div>
      </header>

      <main className="flex flex-1 flex-col">
        {error && (
          <div className="border-b border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-4 py-2 text-xs text-[var(--color-danger)]">
            {error}
          </div>
        )}

        <div className="flex flex-1 items-center justify-center bg-black">
          {media ? (
            <video
              ref={videoRef}
              src={media.url}
              controls={false}
              playsInline
              muted
              crossOrigin="anonymous"
              className="max-h-[60vh] max-w-full"
            />
          ) : (
            <div className="text-xs text-[var(--color-muted)]">불러오는 중…</div>
          )}
        </div>

        {/* Bottom timeline */}
        {media && duration > 0 && (
          <div className="space-y-2 border-t border-[var(--color-line)] bg-[var(--color-surface)] p-2">
            {/* Sprite preview / scrubber */}
            <div
              className="relative h-10 select-none overflow-hidden rounded-md border border-[var(--color-line)] cursor-pointer"
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
                <div
                  className="absolute inset-y-0 w-0.5 bg-[var(--color-accent)]"
                  style={{ left: `${(currentTime / duration) * 100}%` }}
                />
                {frameMarkers.map((m) => (
                  <span
                    key={m.id}
                    className="absolute bottom-0.5 h-2 w-0.5 bg-amber-300"
                    style={{ left: `${m.left}%` }}
                  />
                ))}
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
              {range && (
                <>
                  <div
                    className="absolute inset-y-0 cursor-grab bg-[var(--color-accent)]/30 active:cursor-grabbing"
                    style={{
                      left: `${(range.start / duration) * 100}%`,
                      width: `${((range.end - range.start) / duration) * 100}%`,
                    }}
                  />
                  <div
                    className="absolute inset-y-[-2px] w-1.5 -translate-x-1/2 cursor-ew-resize rounded-sm bg-[var(--color-accent)]"
                    style={{ left: `${(range.start / duration) * 100}%` }}
                  />
                  <div
                    className="absolute inset-y-[-2px] w-1.5 -translate-x-1/2 cursor-ew-resize rounded-sm bg-[var(--color-accent)]"
                    style={{ left: `${(range.end / duration) * 100}%` }}
                  />
                </>
              )}
            </div>

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

            {/* Action row */}
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <button
                type="button"
                onClick={togglePlay}
                className={BTN_DEFAULT}
                title="재생 / 정지 (Space)"
              >
                {isPlaying ? "⏸ 정지" : "▶ 재생"}
              </button>
              <span className="tabular-nums text-[11px] text-[var(--color-muted)]">
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>
              {range && (
                <span className="tabular-nums text-[11px] text-[var(--color-muted)]">
                  · 범위 {formatTime(range.start)}~{formatTime(range.end)} ({span.toFixed(2)}s)
                </span>
              )}

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
              <button
                type="button"
                disabled={busy}
                onClick={() => void captureCurrent()}
                className={BTN_PRIMARY}
                title="현재 프레임을 캡쳐 (C)"
              >
                현재 캡쳐
              </button>

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

              <div className="flex items-center gap-1.5 rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)] px-2 py-1 text-[var(--color-text)]">
                <span className="text-[11px] text-[var(--color-muted)]">step</span>
                <input
                  type="number"
                  min={0.01}
                  step={0.01}
                  value={stepSec}
                  onChange={(e) => setStepSec(Math.max(0.01, parseFloat(e.target.value) || 0))}
                  className="w-14 bg-transparent text-center tabular-nums outline-none"
                />
                <span className="text-[11px] text-[var(--color-muted)]">s</span>
              </div>

              <button
                type="button"
                disabled={framesInRange.length === 0}
                onClick={() => void removeRangeFrames()}
                className={BTN_DANGER}
              >
                범위 {framesInRange.length}개 삭제
              </button>
            </div>
          </div>
        )}

        {/* Extracted frames grid */}
        <section className="border-t border-[var(--color-line)] bg-[var(--color-surface)]">
          <div className="flex items-center gap-2 px-3 py-2">
            <h2 className="text-xs font-semibold tracking-tight">
              추출된 프레임 · {frames.length}장
            </h2>
            {frames.length > 0 && (
              <Link
                href={`/projects/${projectId}`}
                className="ml-auto text-[11px] text-[var(--color-muted)] hover:text-[var(--color-accent)]"
              >
                Media Library 에서 라벨링 시작 →
              </Link>
            )}
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2 px-3 pb-3">
            {frames.map((f) => {
              const ts = f.videoFrameMeta?.timestamp ?? 0;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => seek(ts)}
                  title={`${f.fileName} · ${formatTime(ts)}`}
                  className="group relative overflow-hidden rounded-md border border-[var(--color-line)] bg-black hover:border-[var(--color-accent)]/60"
                >
                  <div className="aspect-square w-full">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={imageBytesUrl(projectId, f.id)}
                      alt={f.fileName}
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  </div>
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/80 to-transparent px-1.5 py-1 text-left text-[10px] text-white">
                    {formatTime(ts)}
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      </main>
    </div>
  );
}

function mergeAndSortByTimestamp(prev: Image[], next: Image[]): Image[] {
  const seen = new Set(prev.map((p) => p.id));
  const out = [...prev];
  for (const n of next) if (!seen.has(n.id)) out.push(n);
  out.sort((a, b) => {
    const ta = a.videoFrameMeta?.timestamp ?? 0;
    const tb = b.videoFrameMeta?.timestamp ?? 0;
    return ta - tb;
  });
  return out;
}
