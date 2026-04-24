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
import { Badge, Button, Card, Checkbox } from "@/shared/ui";
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
  classCounts: Map<string, number>;
  frames: StoredFrame[];
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

  const selectedFrameIds = useMemo(() => {
    const set = new Set<string>();
    for (const f of allFrames) {
      const fromVideo = !!videoChecked[f.videoId];
      const fromFrame = frameChecked[f.id];
      const selected = fromFrame !== undefined ? fromFrame : fromVideo;
      if (selected) set.add(f.id);
    }
    return set;
  }, [allFrames, videoChecked, frameChecked]);

  const hasSelection = selectedFrameIds.size > 0;

  const toggleVideo = (videoId: string) => {
    setVideoChecked((prev) => ({ ...prev, [videoId]: !prev[videoId] }));
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
            className="text-[var(--text-sm)] text-[var(--color-muted)] transition-colors hover:text-[var(--color-text)]"
          >
            ← 프로젝트
          </Link>
          <div className="text-[var(--text-md)] font-semibold tracking-tight text-[var(--color-text-strong)]">
            {project?.name ?? "…"}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="primary" size="sm" onClick={() => setShowUpload(true)}>
            + 동영상 추가
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={onDownload}
            disabled={!hasSelection}
            title={
              hasSelection
                ? "선택된 프레임 + 라벨을 JSON으로 다운로드"
                : "동영상 또는 프레임을 선택하세요"
            }
          >
            선택 다운로드 (JSON){hasSelection ? ` · ${selectedFrameIds.size}` : ""}
          </Button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-6">
        {error && <p className="mb-3 text-[var(--text-sm)] text-[var(--color-danger)]">{error}</p>}
        {loading ? (
          <p className="text-[var(--text-sm)] text-[var(--color-muted)]">불러오는 중…</p>
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

function SectionTitle({ children, hint }: { children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-end justify-between">
      <h2 className="text-[var(--text-xs)] font-semibold uppercase tracking-wide text-[var(--color-muted)]">
        {children}
      </h2>
      {hint ? <p className="text-[var(--text-2xs)] text-[var(--color-subtle)]">{hint}</p> : null}
    </div>
  );
}

function EmptyBlock({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-dashed border-[var(--color-line)] bg-[var(--color-surface)] p-8 text-center text-[var(--text-sm)] text-[var(--color-muted)]">
      {children}
    </div>
  );
}

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
      <SectionTitle>동영상</SectionTitle>
      {bundles.length === 0 ? (
        <EmptyBlock>아직 동영상이 없습니다. 상단의 “동영상 추가”로 업로드하세요.</EmptyBlock>
      ) : (
        <Card padding="none" className="overflow-hidden">
          <table className="w-full table-fixed text-[var(--text-sm)]">
            <colgroup>
              <col style={{ width: 40 }} />
              <col style={{ width: 260 }} />
              <col />
              <col style={{ width: 96 }} />
              <col style={{ width: 72 }} />
              <col style={{ width: 72 }} />
              <col style={{ width: 72 }} />
              <col style={{ width: 160 }} />
            </colgroup>
            <thead className="bg-[var(--color-surface-2)] text-left text-[var(--text-xs)] uppercase tracking-wide text-[var(--color-muted)]">
              <tr>
                <th className="px-3 py-2"></th>
                <th className="px-3 py-2 font-medium">동영상</th>
                <th className="px-3 py-2 font-medium">라벨 종류</th>
                <th className="px-3 py-2 text-right font-medium">해상도</th>
                <th className="px-3 py-2 text-right font-medium">길이</th>
                <th className="px-3 py-2 text-right font-medium">프레임</th>
                <th className="px-3 py-2 text-right font-medium">라벨</th>
                <th className="px-3 py-2 text-right font-medium">작업</th>
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
        </Card>
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

  const classBadges = bundle.classes.filter((c) => bundle.classCounts.has(c.id));

  return (
    <tr className="border-t border-[var(--color-line)] transition-colors hover:bg-[var(--color-hover)]">
      <td className="px-3 py-2 align-top">
        <Checkbox checked={checked} onChange={onToggle} aria-label={`${v.name} 선택`} />
      </td>
      <td className="px-3 py-2 align-top">
        <div className="flex items-start gap-2">
          {inlineThumb && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={inlineThumb}
              alt=""
              loading="lazy"
              className="h-10 w-16 shrink-0 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-black object-cover"
            />
          )}
          <div className="min-w-0 flex-1">
            <button
              type="button"
              onMouseEnter={startReel}
              onMouseMove={moveReel}
              onMouseLeave={stopReel}
              title={v.name}
              aria-label={`${v.name} 미리보기`}
              className="block w-full truncate text-left font-medium text-[var(--color-text-strong)] transition-colors hover:text-[var(--color-accent)]"
            >
              {v.name}
            </button>
            <div className="mt-0.5 flex items-center gap-1.5 truncate text-[var(--text-2xs)] text-[var(--color-muted)]">
              <Badge tone="outline" size="xs" shape="pill" className="uppercase tracking-wide">
                {v.kind}
              </Badge>
              <span className="truncate">{new Date(v.createdAt).toLocaleString()}</span>
            </div>
          </div>
        </div>
      </td>
      <td className="px-3 py-2 align-top">
        {classBadges.length === 0 ? (
          <span className="text-[var(--text-2xs)] text-[var(--color-subtle)]">—</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {classBadges.map((c) => (
              <Badge
                key={c.id}
                size="xs"
                shape="pill"
                color={c.color}
                className="max-w-full"
                title={`${c.name} · ${bundle.classCounts.get(c.id) ?? 0}`}
                swatch={<span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-70" />}
              >
                <span className="truncate">
                  {c.name} · {bundle.classCounts.get(c.id) ?? 0}
                </span>
              </Badge>
            ))}
          </div>
        )}
      </td>
      <td className="px-3 py-2 text-right align-top tabular-nums text-[var(--color-muted)]">
        {v.width}×{v.height}
      </td>
      <td className="px-3 py-2 text-right align-top tabular-nums text-[var(--color-muted)]">
        {v.duration ? `${v.duration.toFixed(1)}s` : "—"}
      </td>
      <td className="px-3 py-2 text-right align-top tabular-nums text-[var(--color-text)]">
        {v.frameCount}
      </td>
      <td className="px-3 py-2 text-right align-top tabular-nums text-[var(--color-text)]">
        {v.annotationCount}
      </td>
      <td className="px-3 py-2 text-right align-top">
        <div className="flex items-center justify-end gap-2">
          <Link
            href={`/projects/${projectId}/videos/${v.id}`}
            className="inline-flex h-7 items-center rounded-[var(--radius-md)] bg-[var(--color-accent-soft)] px-2.5 text-[var(--text-xs)] font-medium text-[var(--color-accent)] transition-colors hover:bg-[var(--color-accent)] hover:text-[var(--color-accent-contrast)]"
          >
            Labeling
          </Link>
          <Button
            variant="secondary"
            size="xs"
            onClick={onDelete}
            className="text-[var(--color-muted)] hover:border-[var(--color-danger)] hover:text-[var(--color-danger)]"
          >
            삭제
          </Button>
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
      className="pointer-events-none fixed z-40 overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)] bg-black shadow-[var(--shadow-lg)]"
      style={{ left, top, width: W }}
    >
      <div className="relative">
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
        <div className="absolute bottom-1 right-2 rounded-[var(--radius-xs)] bg-black/70 px-1.5 py-0.5 text-[var(--text-2xs)] tabular-nums text-white">
          {idx + 1} / {previewCount}
        </div>
      </div>
    </div>,
    document.body,
  );
}

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

  useEffect(() => {
    setVisibleCount((c) => Math.min(c, Math.max(FRAMES_PAGE_SIZE, frames.length)));
  }, [frames.length]);

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
      <SectionTitle
        hint="체크박스로 개별 선택 · 미리보기 버튼에 마우스를 올리면 라벨 포함 확대"
      >
        이미지 ({frames.length})
        {selectedFrameIds.size > 0 && (
          <span className="ml-2 text-[var(--color-accent)]">
            · 선택됨 {selectedFrameIds.size}
          </span>
        )}
      </SectionTitle>

      {frames.length === 0 ? (
        <EmptyBlock>
          아직 추출된 프레임이 없습니다. Labeling 화면에서 프레임을 추출하세요.
        </EmptyBlock>
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
                    "group relative overflow-hidden rounded-[var(--radius-md)] border bg-[var(--color-surface)] transition-colors",
                    isSelected
                      ? "border-[var(--color-accent)] ring-2 ring-[var(--color-accent)]/30"
                      : "border-[var(--color-line)] hover:border-[var(--color-line-strong)]",
                  ].join(" ")}
                >
                  <label className="absolute left-1 top-1 z-10 flex items-center gap-1 rounded-[var(--radius-xs)] bg-black/60 px-1.5 py-0.5 text-[var(--text-2xs)] text-white">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => onToggleFrame(f)}
                      className="h-3 w-3 accent-[var(--color-accent)]"
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
                    <div className="flex min-w-0 flex-col leading-[var(--leading-tight)]">
                      <span className="truncate text-[var(--text-xs)] text-[var(--color-text)]">{f.label}</span>
                      <span className="truncate text-[var(--text-2xs)] text-[var(--color-muted)]">
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
                      className="shrink-0 rounded-[var(--radius-full)] bg-[var(--color-surface-2)] px-2 py-0.5 text-[var(--text-2xs)] text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface-3)] hover:text-[var(--color-accent)]"
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
              className="mt-4 py-6 text-center text-[var(--text-xs)] text-[var(--color-muted)]"
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
      className="pointer-events-none fixed z-40 overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)] bg-black shadow-[var(--shadow-lg)]"
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
            if (a.shape.kind !== "rect") return null;
            const c = bundle?.classById.get(a.classId);
            const color = c?.color ?? "#5b8cff";
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
          })}
        </svg>
        {annotations.map((a) => {
          if (a.shape.kind !== "rect") return null;
          const c = bundle?.classById.get(a.classId);
          const color = c?.color ?? "#5b8cff";
          return (
            <span
              key={`label-${a.id}`}
              className="absolute rounded-[var(--radius-xs)] px-1 text-[var(--text-2xs)] font-medium text-black"
              style={{
                left: `${a.shape.x * 100}%`,
                top: `${a.shape.y * 100}%`,
                background: color,
                transform: "translateY(-100%)",
              }}
            >
              {c?.name ?? "?"}
            </span>
          );
        })}
      </div>
      <div className="flex items-center justify-between gap-2 bg-black/80 px-2 py-1 text-[var(--text-2xs)] text-white/80">
        <span className="truncate">{frame.videoName} · {frame.label}</span>
        <span className="tabular-nums">{annotations.length} labels</span>
      </div>
    </div>,
    document.body,
  );
}
