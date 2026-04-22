"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
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
} from "@/features/projects/service/api";
import { UploadVideoModal } from "./UploadVideoModal";

type FrameWithVideo = StoredFrame & { videoName: string };

export function ProjectDetailPage({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [videos, setVideos] = useState<VideoSummary[]>([]);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [frames, setFrames] = useState<FrameWithVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewPos, setPreviewPos] = useState<{ x: number; y: number }>({
    x: 0,
    y: 0,
  });

  const refresh = async () => {
    try {
      const detail = await getProjectDetail(projectId);
      setProject(detail.project);
      setVideos(detail.videos);

      // Load frames from each video (in parallel)
      const results = await Promise.all(
        detail.videos.map(async (v) => {
          const { data } = await getVideoData(projectId, v.id);
          return data.frames.map<FrameWithVideo>((f) => ({
            ...f,
            videoName: v.name,
          }));
        }),
      );
      setFrames(results.flat());
    } catch (e) {
      setError(e instanceof Error ? e.message : "프로젝트를 불러오지 못했습니다");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const checkedIds = useMemo(
    () => Object.keys(checked).filter((k) => checked[k]),
    [checked],
  );
  const hasSelection = checkedIds.length > 0;

  const selectedFrames = useMemo(
    () =>
      hasSelection
        ? frames.filter((f) => checked[f.videoId])
        : [],
    [frames, checked, hasSelection],
  );
  const selectedFrameIds = useMemo(
    () => new Set(selectedFrames.map((f) => f.id)),
    [selectedFrames],
  );

  const toggleChecked = (videoId: string) =>
    setChecked((prev) => ({ ...prev, [videoId]: !prev[videoId] }));

  const onDeleteVideo = async (v: VideoSummary) => {
    if (!confirm(`동영상 "${v.name}" 을(를) 삭제하시겠습니까?`)) return;
    await apiDeleteVideo(projectId, v.id);
    setChecked((prev) => {
      const next = { ...prev };
      delete next[v.id];
      return next;
    });
    await refresh();
  };

  const onDownload = () => {
    const href = exportUrl(projectId, checkedIds);
    // Force download via a hidden anchor — the server sets Content-Disposition.
    const a = document.createElement("a");
    a.href = href;
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
            title={hasSelection ? "선택된 동영상의 프레임+라벨 JSON 다운로드" : "동영상을 체크하세요"}
          >
            선택 다운로드 (JSON)
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-6">
        {error && <p className="mb-3 text-sm text-[var(--color-danger)]">{error}</p>}
        {loading ? (
          <p className="text-sm text-[var(--color-muted)]">불러오는 중…</p>
        ) : (
          <>
            <section className="mb-8">
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
                동영상
              </h2>
              {videos.length === 0 ? (
                <div className="rounded-lg border border-dashed border-[var(--color-line)] bg-[var(--color-surface)] p-8 text-center text-sm text-[var(--color-muted)]">
                  아직 동영상이 없습니다. 상단의 “동영상 추가”로 업로드하세요.
                </div>
              ) : (
                <div className="overflow-hidden rounded-lg border border-[var(--color-line)]">
                  <table className="w-full text-sm">
                    <thead className="bg-[var(--color-surface)] text-left text-xs text-[var(--color-muted)]">
                      <tr>
                        <th className="w-8 px-3 py-2"></th>
                        <th className="px-3 py-2">이름</th>
                        <th className="px-3 py-2">유형</th>
                        <th className="px-3 py-2 text-right">해상도</th>
                        <th className="px-3 py-2 text-right">길이</th>
                        <th className="px-3 py-2 text-right">프레임</th>
                        <th className="px-3 py-2 text-right">라벨</th>
                        <th className="w-40 px-3 py-2 text-right">작업</th>
                      </tr>
                    </thead>
                    <tbody>
                      {videos.map((v) => (
                        <tr
                          key={v.id}
                          className="border-t border-[var(--color-line)] bg-[var(--color-surface)]/40"
                        >
                          <td className="px-3 py-2">
                            <input
                              type="checkbox"
                              checked={!!checked[v.id]}
                              onChange={() => toggleChecked(v.id)}
                              aria-label={`${v.name} 선택`}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <div className="truncate font-medium">{v.name}</div>
                            <div className="text-[10px] text-[var(--color-muted)]">
                              {new Date(v.createdAt).toLocaleString()}
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <span className="rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[10px] uppercase">
                              {v.kind}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {v.width}×{v.height}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {v.duration ? `${v.duration.toFixed(1)}s` : "—"}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {v.frameCount}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {v.annotationCount}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <Link
                                href={`/projects/${projectId}/videos/${v.id}`}
                                className="rounded-md bg-[var(--color-accent-soft)] px-2 py-1 text-[11px] font-medium text-[var(--color-accent)]"
                              >
                                Labeling
                              </Link>
                              <button
                                type="button"
                                onClick={() => void onDeleteVideo(v)}
                                className="rounded-md border border-[var(--color-line)] px-2 py-1 text-[11px] text-[var(--color-muted)] hover:border-[var(--color-danger)] hover:text-[var(--color-danger)]"
                              >
                                삭제
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section>
              <div className="mb-2 flex items-end justify-between">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
                  이미지 ({frames.length})
                  {hasSelection && (
                    <span className="ml-2 text-[var(--color-accent)]">
                      · 선택됨 {selectedFrames.length}
                    </span>
                  )}
                </h2>
                <p className="text-[10px] text-[var(--color-muted)]">
                  미리보기 버튼에 마우스를 올리면 확대 이미지를 볼 수 있습니다.
                </p>
              </div>
              {frames.length === 0 ? (
                <div className="rounded-lg border border-dashed border-[var(--color-line)] bg-[var(--color-surface)] p-8 text-center text-sm text-[var(--color-muted)]">
                  아직 추출된 프레임이 없습니다. Labeling 화면에서 프레임을 추출하세요.
                </div>
              ) : (
                <ul
                  role="list"
                  className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2"
                >
                  {frames.map((f) => {
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
                            onMouseEnter={(e) => {
                              setPreviewUrl(url);
                              setPreviewPos({ x: e.clientX, y: e.clientY });
                            }}
                            onMouseMove={(e) =>
                              setPreviewPos({ x: e.clientX, y: e.clientY })
                            }
                            onMouseLeave={() => setPreviewUrl(null)}
                            className="shrink-0 rounded-full bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[10px] text-[var(--color-muted)] hover:text-[var(--color-accent)]"
                          >
                            미리보기
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </>
        )}
      </main>

      {previewUrl && (
        <div
          className="pointer-events-none fixed z-40 overflow-hidden rounded-md border border-[var(--color-line)] bg-black shadow-2xl"
          style={{
            left: Math.min(previewPos.x + 16, window.innerWidth - 420),
            top: Math.min(previewPos.y + 16, window.innerHeight - 260),
            width: 400,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewUrl}
            alt="preview"
            className="block h-auto w-full"
          />
        </div>
      )}

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
