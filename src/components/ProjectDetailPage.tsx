"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { polygonPath, shapeAabb } from "@/features/annotations";
import type { Annotation, LabelClass } from "@/features/annotations/types";
import type {
  Project,
  StoredFrame,
  VideoSummary,
} from "@/features/projects";
import {
  deleteVideo as apiDeleteVideo,
  exportUrl,
  frameImageUrl,
  getProjectDetail,
  getVideoData,
  previewUrl,
} from "@/features/projects/service/api";
import { UploadVideoModal } from "./UploadVideoModal";

const FRAMES_PAGE_SIZE = 50;
const PREVIEW_REEL_INTERVAL_MS = 220;

type FrameWithVideo = StoredFrame & {
  videoId: string;
  videoName: string;
};

type VideoBundle = {
  summary: VideoSummary;
  classes: LabelClass[];
  classById: Map<string, LabelClass>;
  // counts per class id (annotation count)
  classCounts: Map<string, number>;
  frames: StoredFrame[];
  // per-frame annotations
  annotationsByFrame: Map<string, Annotation[]>;
};

export function ProjectDetailPage({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [bundles, setBundles] = useState<VideoBundle[]>([]);
  const [videoChecked, setVideoChecked] = useState<Record<string, boolean>>({});
  const [frameChecked, setFrameChecked] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showUpload, setShowUpload] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const detail = await getProjectDetail(projectId);
      setProject(detail.project);

      const next = await Promise.all(
        detail.videos.map(async (v): Promise<VideoBundle> => {
          const { data } = await getVideoData(projectId, v.id);
          const classById = new Map(data.classes.map((c) => [c.id, c]));
          const classCounts = new Map<string, number>();
          const annotationsByFrame = new Map<string, Annotation[]>();
          for (const a of data.annotations) {
            classCounts.set(a.classId, (classCounts.get(a.classId) ?? 0) + 1);
            const arr = annotationsByFrame.get(a.frameId);
            if (arr) arr.push(a);
            else annotationsByFrame.set(a.frameId, [a]);
          }
          return {
            summary: v,
            classes: data.classes,
            classById,
            classCounts,
            frames: data.frames,
            annotationsByFrame,
          };
        }),
      );
      setBundles(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "프로젝트를 불러오지 못했습니다");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Flatten frames across videos for the bottom grid (preserve per-video
  // order, videos in summary order).
  const allFrames = useMemo<FrameWithVideo[]>(() => {
    const out: FrameWithVideo[] = [];
    for (const b of bundles) {
      for (const f of b.frames) {
        out.push({
          ...f,
          videoId: b.summary.id,
          videoName: b.summary.name,
        });
      }
    }
    return out;
  }, [bundles]);

  const bundleByVideoId = useMemo(() => {
    const m = new Map<string, VideoBundle>();
    for (const b of bundles) m.set(b.summary.id, b);
    return m;
  }, [bundles]);

  // Effective selection: a frame is selected if its video is checked OR the
  // frame is individually checked. The per-frame checkbox lets the user
  // un-check a single frame off a fully-checked video by toggling it (the
  // checkbox shows merged state).
  const selectedFrameIds = useMemo(() => {
    const set = new Set<string>();
    for (const f of allFrames) {
      const fromVideo = !!videoChecked[f.videoId];
      const fromFrame = frameChecked[f.id];
      // If video is checked, default to selected unless the frame was
      // explicitly turned off (frameChecked[f.id] === false).
      const selected = fromFrame !== undefined ? fromFrame : fromVideo;
      if (selected) set.add(f.id);
    }
    return set;
  }, [allFrames, videoChecked, frameChecked]);

  const hasSelection = selectedFrameIds.size > 0;

  const toggleVideo = (videoId: string) => {
    setVideoChecked((prev) => {
      const next = { ...prev, [videoId]: !prev[videoId] };
      return next;
    });
    // Clear per-frame overrides for that video so the new video state takes
    // hold uniformly.
    setFrameChecked((prev) => {
      const next = { ...prev };
      const bundle = bundleByVideoId.get(videoId);
      if (bundle) for (const f of bundle.frames) delete next[f.id];
      return next;
    });
  };

  const toggleFrame = (f: FrameWithVideo) => {
    setFrameChecked((prev) => {
      const fromVideo = !!videoChecked[f.videoId];
      const current = prev[f.id] !== undefined ? prev[f.id] : fromVideo;
      return { ...prev, [f.id]: !current };
    });
  };

  const onDeleteVideo = async (v: VideoSummary) => {
    if (!confirm(`동영상 "${v.name}" 을(를) 삭제하시겠습니까?`)) return;
    await apiDeleteVideo(projectId, v.id);
    setVideoChecked((prev) => {
      const next = { ...prev };
      delete next[v.id];
      return next;
    });
    await refresh();
  };

  const onDownload = () => {
    const ids = [...selectedFrameIds];
    const a = document.createElement("a");
    a.href = exportUrl(projectId, { frameIds: ids });
    a.download = "";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="flex min-h-screen flex-col bg-[var(--color-bg)]">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--color-line)] bg-[var(--color-surface)] px-4">
        <div className="flex items-center gap-3">
          <Link
            href="/projects"
            className="text-xs text-[var(--color-muted)] hover:text-[var(--color-text)]"
          >
            ← 프로젝트
          </Link>
          <div className="text-sm font-semibold tracking-tight">
            {project?.name ?? "…"}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowUpload(true)}
            className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-xs font-medium text-black"
          >
            + 동영상 추가
          </button>
          <button
            type="button"
            onClick={onDownload}
            disabled={!hasSelection}
            className="rounded-md border border-[var(--color-line)] px-3 py-1.5 text-xs hover:border-[var(--color-accent)] disabled:opacity-40"
            title={
              hasSelection
                ? "선택된 프레임 + 라벨을 JSON으로 다운로드"
                : "동영상 또는 프레임을 선택하세요"
            }
          >
            선택 다운로드 (JSON) {hasSelection && `· ${selectedFrameIds.size}`}
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-6">
        {error && <p className="mb-3 text-sm text-[var(--color-danger)]">{error}</p>}
        {loading ? (
          <p className="text-sm text-[var(--color-muted)]">불러오는 중…</p>
        ) : (
          <>
            <VideoTable
              projectId={projectId}
              bundles={bundles}
              videoChecked={videoChecked}
              onToggleVideo={toggleVideo}
              onDelete={onDeleteVideo}
            />
            <FramesGrid
              projectId={projectId}
              frames={allFrames}
              selectedFrameIds={selectedFrameIds}
              bundleByVideoId={bundleByVideoId}
              onToggleFrame={toggleFrame}
            />
          </>
        )}
      </main>

      {showUpload && (
        <UploadVideoModal
          projectId={projectId}
          onClose={() => setShowUpload(false)}
          onUploaded={() => void refresh()}
        />
      )}
    </div>
  );
}

// ---------------- VideoTable ----------------

function VideoTable({
  projectId,
  bundles,
  videoChecked,
  onToggleVideo,
  onDelete,
}: {
  projectId: string;
  bundles: VideoBundle[];
  videoChecked: Record<string, boolean>;
  onToggleVideo: (id: string) => void;
  onDelete: (v: VideoSummary) => Promise<void> | void;
}) {
  return (
    <section className="mb-8">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
        동영상
      </h2>
      {bundles.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--color-line)] bg-[var(--color-surface)] p-8 text-center text-sm text-[var(--color-muted)]">
          아직 동영상이 없습니다. 상단의 “동영상 추가”로 업로드하세요.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-[var(--color-line)]">
          <table className="w-full table-fixed text-sm">
            <colgroup>
              {/* Fixed widths so rows don't reflow as class badges pile up.
                  The "라벨 종류" column is the only flexible one — it soaks
                  up the leftover space and wraps its pills to new lines. */}
              <col style={{ width: 40 }} />
              <col style={{ width: 260 }} />
              <col />
              <col style={{ width: 96 }} />
              <col style={{ width: 72 }} />
              <col style={{ width: 72 }} />
              <col style={{ width: 72 }} />
              <col style={{ width: 160 }} />
            </colgroup>
            <thead className="bg-[var(--color-surface)] text-left text-xs text-[var(--color-muted)]">
              <tr>
                <th className="px-3 py-2"></th>
                <th className="px-3 py-2">동영상</th>
                <th className="px-3 py-2">라벨 종류</th>
                <th className="px-3 py-2 text-right">해상도</th>
                <th className="px-3 py-2 text-right">길이</th>
                <th className="px-3 py-2 text-right">프레임</th>
                <th className="px-3 py-2 text-right">라벨</th>
                <th className="px-3 py-2 text-right">작업</th>
              </tr>
            </thead>
            <tbody>
              {bundles.map((b) => (
                <VideoRow
                  key={b.summary.id}
                  projectId={projectId}
                  bundle={b}
                  checked={!!videoChecked[b.summary.id]}
                  onToggle={() => onToggleVideo(b.summary.id)}
                  onDelete={() => void onDelete(b.summary)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function VideoRow({
  projectId,
  bundle,
  checked,
  onToggle,
  onDelete,
}: {
  projectId: string;
  bundle: VideoBundle;
  checked: boolean;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const v = bundle.summary;
  const previewCount = v.previewCount ?? 0;

  // Hover reel: cycle through preview-0..N every PREVIEW_REEL_INTERVAL_MS.
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hoverPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const [, force] = useState(0);

  const startReel = (e: React.MouseEvent) => {
    if (previewCount <= 0) return;
    hoverPosRef.current = { x: e.clientX, y: e.clientY };
    setHoverIdx(0);
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      setHoverIdx((i) => (i === null ? 0 : (i + 1) % previewCount));
    }, PREVIEW_REEL_INTERVAL_MS);
  };
  const moveReel = (e: React.MouseEvent) => {
    if (hoverIdx === null) return;
    hoverPosRef.current = { x: e.clientX, y: e.clientY };
    force((n) => n + 1);
  };
  const stopReel = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setHoverIdx(null);
  };
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const inlineThumb =
    previewCount > 0 ? previewUrl(projectId, v.id, 0) : null;

  // Class breakdown badges (unique class types with counts).
  const classBadges = bundle.classes.filter((c) =>
    bundle.classCounts.has(c.id),
  );

  return (
    <tr className="border-t border-[var(--color-line)] bg-[var(--color-surface)]/40">
      <td className="px-3 py-2 align-top">
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          aria-label={`${v.name} 선택`}
        />
      </td>
      <td className="px-3 py-2 align-top">
        <div className="flex items-start gap-2">
          {inlineThumb && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={inlineThumb}
              alt=""
              loading="lazy"
              className="h-10 w-16 shrink-0 rounded border border-[var(--color-line)] bg-black object-cover"
            />
          )}
          <div className="min-w-0 flex-1">
            {/* block + w-full makes `truncate` work inside the flex cell:
                truncate requires a width-bounded block box to apply the
                ellipsis. title attribute exposes the full name on hover. */}
            <button
              type="button"
              onMouseEnter={startReel}
              onMouseMove={moveReel}
              onMouseLeave={stopReel}
              title={v.name}
              aria-label={`${v.name} 미리보기`}
              className="block w-full truncate text-left font-medium hover:text-[var(--color-accent)]"
            >
              {v.name}
            </button>
            <div className="truncate text-[10px] text-[var(--color-muted)]">
              <span className="rounded bg-[var(--color-surface-2)] px-1 py-px uppercase tracking-wide">
                {v.kind}
              </span>{" "}
              · {new Date(v.createdAt).toLocaleString()}
            </div>
          </div>
        </div>
      </td>
      <td className="px-3 py-2 align-top">
        {classBadges.length === 0 ? (
          <span className="text-[10px] text-[var(--color-muted)]">—</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {classBadges.map((c) => (
              <span
                key={c.id}
                className="inline-flex max-w-full items-center gap-1 rounded-full px-1.5 py-px text-[10px] text-white"
                style={{ background: c.color }}
                title={`${c.name} · ${bundle.classCounts.get(c.id) ?? 0}`}
              >
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-white/60" />
                <span className="truncate">
                  {c.name} · {bundle.classCounts.get(c.id) ?? 0}
                </span>
              </span>
            ))}
          </div>
        )}
      </td>
      <td className="px-3 py-2 text-right align-top tabular-nums">
        {v.width}×{v.height}
      </td>
      <td className="px-3 py-2 text-right align-top tabular-nums">
        {v.duration ? `${v.duration.toFixed(1)}s` : "—"}
      </td>
      <td className="px-3 py-2 text-right align-top tabular-nums">
        {v.frameCount}
      </td>
      <td className="px-3 py-2 text-right align-top tabular-nums">
        {v.annotationCount}
      </td>
      <td className="px-3 py-2 text-right align-top">
        <div className="flex items-center justify-end gap-2">
          <Link
            href={`/projects/${projectId}/videos/${v.id}`}
            className="rounded-md bg-[var(--color-accent-soft)] px-2 py-1 text-[11px] font-medium text-[var(--color-accent)]"
          >
            Labeling
          </Link>
          <button
            type="button"
            onClick={onDelete}
            className="rounded-md border border-[var(--color-line)] px-2 py-1 text-[11px] text-[var(--color-muted)] hover:border-[var(--color-danger)] hover:text-[var(--color-danger)]"
          >
            삭제
          </button>
        </div>
      </td>
      {hoverIdx !== null && previewCount > 0 && (
        <PreviewReelTooltip
          projectId={projectId}
          videoId={v.id}
          idx={hoverIdx}
          previewCount={previewCount}
          pos={hoverPosRef.current}
        />
      )}
    </tr>
  );
}

function PreviewReelTooltip({
  projectId,
  videoId,
  idx,
  previewCount,
  pos,
}: {
  projectId: string;
  videoId: string;
  idx: number;
  previewCount: number;
  pos: { x: number; y: number };
}) {
  if (typeof document === "undefined") return null;
  const W = 360;
  const H = 220;
  const left = Math.min(pos.x + 16, window.innerWidth - W - 8);
  const top = Math.min(pos.y + 16, window.innerHeight - H - 8);
  return createPortal(
    <div
      className="pointer-events-none fixed z-40 overflow-hidden rounded-md border border-[var(--color-line)] bg-black shadow-2xl"
      style={{ left, top, width: W }}
    >
      <div className="relative">
        {/* Render every preview but show only the active one. Pre-mounting
            them lets the browser cache the images so cycling is smooth. */}
        {Array.from({ length: previewCount }).map((_, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={i}
            src={previewUrl(projectId, videoId, i)}
            alt=""
            className="block h-auto w-full"
            style={{ display: i === idx ? "block" : "none" }}
          />
        ))}
        <div className="absolute bottom-1 right-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] tabular-nums text-white">
          {idx + 1} / {previewCount}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ---------------- FramesGrid ----------------

function FramesGrid({
  projectId,
  frames,
  selectedFrameIds,
  bundleByVideoId,
  onToggleFrame,
}: {
  projectId: string;
  frames: FrameWithVideo[];
  selectedFrameIds: Set<string>;
  bundleByVideoId: Map<string, VideoBundle>;
  onToggleFrame: (f: FrameWithVideo) => void;
}) {
  const [visibleCount, setVisibleCount] = useState(FRAMES_PAGE_SIZE);
  const [preview, setPreview] = useState<{
    frame: FrameWithVideo;
    pos: { x: number; y: number };
  } | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Reset window when the underlying list shrinks (e.g. after a video
  // deletion) so the user doesn't end up scrolled past the end.
  useEffect(() => {
    setVisibleCount((c) => Math.min(c, Math.max(FRAMES_PAGE_SIZE, frames.length)));
  }, [frames.length]);

  // Lazy-load more rows as the sentinel scrolls into view. 50 at a time.
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    if (visibleCount >= frames.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setVisibleCount((c) =>
              Math.min(c + FRAMES_PAGE_SIZE, frames.length),
            );
          }
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [frames.length, visibleCount]);

  const visible = useMemo(
    () => frames.slice(0, visibleCount),
    [frames, visibleCount],
  );

  return (
    <section>
      <div className="mb-2 flex items-end justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
          이미지 ({frames.length})
          {selectedFrameIds.size > 0 && (
            <span className="ml-2 text-[var(--color-accent)]">
              · 선택됨 {selectedFrameIds.size}
            </span>
          )}
        </h2>
        <p className="text-[10px] text-[var(--color-muted)]">
          체크박스로 개별 선택 · 미리보기 버튼에 마우스를 올리면 라벨 포함 확대
        </p>
      </div>
      {frames.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--color-line)] bg-[var(--color-surface)] p-8 text-center text-sm text-[var(--color-muted)]">
          아직 추출된 프레임이 없습니다. Labeling 화면에서 프레임을 추출하세요.
        </div>
      ) : (
        <>
          <ul
            role="list"
            className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2"
          >
            {visible.map((f) => {
              const url = frameImageUrl(projectId, f.videoId, f.id);
              const isSelected = selectedFrameIds.has(f.id);
              return (
                <li
                  key={f.id}
                  className={[
                    "relative overflow-hidden rounded-md border bg-[var(--color-surface)]",
                    isSelected
                      ? "border-[var(--color-accent)] ring-2 ring-[var(--color-accent)]/30"
                      : "border-[var(--color-line)]",
                  ].join(" ")}
                >
                  <label className="absolute left-1 top-1 z-10 flex items-center rounded bg-black/55 px-1.5 py-0.5 text-[10px] text-white">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => onToggleFrame(f)}
                      className="mr-1 h-3 w-3 accent-[var(--color-accent)]"
                      aria-label="프레임 선택"
                    />
                    선택
                  </label>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={url}
                    alt={f.label}
                    loading="lazy"
                    decoding="async"
                    className="aspect-video w-full bg-black object-contain"
                  />
                  <div className="flex items-center justify-between gap-1 px-2 py-1">
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate text-[11px]">{f.label}</span>
                      <span className="truncate text-[10px] text-[var(--color-muted)]">
                        {f.videoName}
                      </span>
                    </div>
                    <button
                      type="button"
                      aria-label="미리보기"
                      onMouseEnter={(e) =>
                        setPreview({
                          frame: f,
                          pos: { x: e.clientX, y: e.clientY },
                        })
                      }
                      onMouseMove={(e) =>
                        setPreview((p) =>
                          p
                            ? { ...p, pos: { x: e.clientX, y: e.clientY } }
                            : p,
                        )
                      }
                      onMouseLeave={() => setPreview(null)}
                      className="shrink-0 rounded-full bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[10px] text-[var(--color-muted)] hover:text-[var(--color-accent)]"
                    >
                      미리보기
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          {visibleCount < frames.length && (
            <div
              ref={sentinelRef}
              className="mt-4 py-6 text-center text-[11px] text-[var(--color-muted)]"
            >
              더 불러오는 중… ({visibleCount} / {frames.length})
            </div>
          )}
        </>
      )}

      {preview && (
        <FramePreviewTooltip
          projectId={projectId}
          frame={preview.frame}
          pos={preview.pos}
          bundle={bundleByVideoId.get(preview.frame.videoId) ?? null}
        />
      )}
    </section>
  );
}

// ---------------- FramePreviewTooltip ----------------

function FramePreviewTooltip({
  projectId,
  frame,
  pos,
  bundle,
}: {
  projectId: string;
  frame: FrameWithVideo;
  pos: { x: number; y: number };
  bundle: VideoBundle | null;
}) {
  if (typeof document === "undefined") return null;
  const W = 440;
  const H = (W * frame.height) / Math.max(1, frame.width);
  const left = Math.min(pos.x + 16, window.innerWidth - W - 8);
  const top = Math.min(pos.y + 16, window.innerHeight - H - 32);
  const annotations = bundle?.annotationsByFrame.get(frame.id) ?? [];
  return createPortal(
    <div
      className="pointer-events-none fixed z-40 overflow-hidden rounded-md border border-[var(--color-line)] bg-black shadow-2xl"
      style={{ left, top, width: W }}
    >
      <div className="relative" style={{ aspectRatio: `${frame.width} / ${frame.height}` }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={frameImageUrl(projectId, frame.videoId, frame.id)}
          alt={frame.label}
          className="absolute inset-0 block h-full w-full object-contain"
        />
        <svg
          viewBox="0 0 1 1"
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full"
        >
          {annotations.map((a) => {
            const c = bundle?.classById.get(a.classId);
            const color = c?.color ?? "#5b8cff";
            if (a.shape.kind === "rect") {
              return (
                <rect
                  key={a.id}
                  x={a.shape.x}
                  y={a.shape.y}
                  width={a.shape.w}
                  height={a.shape.h}
                  fill={color}
                  fillOpacity={0.15}
                  stroke={color}
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                />
              );
            }
            const d = polygonPath(a.shape.rings);
            if (!d) return null;
            return (
              <path
                key={a.id}
                d={d}
                fill={color}
                fillOpacity={0.15}
                fillRule="evenodd"
                stroke={color}
                strokeWidth={2}
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
        </svg>
        {/* Class labels for each annotation, anchored to the rect's top-left
            corner. HTML-positioned so text isn't distorted by the SVG's
            non-uniform preserveAspectRatio. */}
        {annotations.map((a) => {
          const c = bundle?.classById.get(a.classId);
          const color = c?.color ?? "#5b8cff";
          const b = shapeAabb(a.shape);
          return (
            <span
              key={`label-${a.id}`}
              className="absolute rounded-sm px-1 text-[10px] font-medium text-black"
              style={{
                left: `${b.x * 100}%`,
                top: `${b.y * 100}%`,
                background: color,
                transform: "translateY(-100%)",
              }}
            >
              {c?.name ?? "?"}
            </span>
          );
        })}
      </div>
      <div className="flex items-center justify-between gap-2 bg-black/80 px-2 py-1 text-[10px] text-white/80">
        <span className="truncate">{frame.videoName} · {frame.label}</span>
        <span className="tabular-nums">{annotations.length} labels</span>
      </div>
    </div>,
    document.body,
  );
}
