"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ImageMeta,
  LabelSetSummary,
  Project,
  ResourceSummary,
} from "@/features/projects";
import {
  deleteLabelSet as apiDeleteLabelSet,
  deleteResource as apiDeleteResource,
  exportUrl,
  getProjectDetail,
  imageUrl,
  previewUrl,
} from "@/features/projects/service/api";
import { CreateLabelSetModal } from "./CreateLabelSetModal";
import { UploadResourceModal } from "./UploadResourceModal";

const PREVIEW_REEL_INTERVAL_MS = 220;

type Tab = "resources" | "images" | "labelsets";

export function ProjectDetailPage({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [resources, setResources] = useState<ResourceSummary[]>([]);
  const [images, setImages] = useState<ImageMeta[]>([]);
  const [labelsets, setLabelsets] = useState<LabelSetSummary[]>([]);
  const [tab, setTab] = useState<Tab>("resources");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showUpload, setShowUpload] = useState<null | "video" | "image_batch">(null);
  const [showCreateLabelSet, setShowCreateLabelSet] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const detail = await getProjectDetail(projectId);
      setProject(detail.project);
      setResources(detail.resources);
      setImages(detail.images);
      setLabelsets(detail.labelsets);
    } catch (e) {
      setError(e instanceof Error ? e.message : "프로젝트를 불러오지 못했습니다");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onDeleteResource = async (r: ResourceSummary) => {
    const noun = r.kind === "video" ? "동영상" : "이미지 묶음";
    if (
      !confirm(
        `${noun} "${r.name}" 을(를) 삭제할까요? 포함된 이미지 ${r.imageCount}장과 라벨셋 멤버십이 함께 정리됩니다.`,
      )
    ) {
      return;
    }
    await apiDeleteResource(projectId, r.id);
    await refresh();
  };

  const onDeleteLabelSet = async (ls: LabelSetSummary) => {
    if (!confirm(`라벨셋 "${ls.name}" 을(를) 삭제하시겠습니까?`)) return;
    await apiDeleteLabelSet(projectId, ls.id);
    await refresh();
  };

  const onDownloadAll = () => {
    const a = document.createElement("a");
    a.href = exportUrl(projectId);
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
            onClick={() => setShowUpload("video")}
            className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-1.5 text-xs"
          >
            + 동영상
          </button>
          <button
            type="button"
            onClick={() => setShowUpload("image_batch")}
            className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-1.5 text-xs"
          >
            + 이미지 묶음
          </button>
          <button
            type="button"
            onClick={() => setShowCreateLabelSet(true)}
            disabled={images.length === 0}
            className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-xs font-medium text-black disabled:opacity-40"
          >
            + 라벨셋
          </button>
          <button
            type="button"
            onClick={onDownloadAll}
            disabled={labelsets.length === 0}
            className="rounded-md border border-[var(--color-line)] px-3 py-1.5 text-xs hover:border-[var(--color-accent)] disabled:opacity-40"
            title="전체 라벨셋을 JSON으로 다운로드"
          >
            전체 다운로드
          </button>
        </div>
      </header>

      <nav className="flex shrink-0 gap-1 border-b border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-1.5 text-xs">
        {(
          [
            { id: "resources", label: `Resource Pool (${resources.length})` },
            { id: "images", label: `Image Pool (${images.length})` },
            { id: "labelsets", label: `Label Sets (${labelsets.length})` },
          ] as { id: Tab; label: string }[]
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={[
              "rounded px-3 py-1 transition",
              tab === t.id
                ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                : "text-[var(--color-muted)] hover:text-[var(--color-text)]",
            ].join(" ")}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-6">
        {error && (
          <p className="mb-3 text-sm text-[var(--color-danger)]">{error}</p>
        )}
        {loading ? (
          <p className="text-sm text-[var(--color-muted)]">불러오는 중…</p>
        ) : tab === "resources" ? (
          <ResourcePool
            projectId={projectId}
            resources={resources}
            onDelete={onDeleteResource}
          />
        ) : tab === "images" ? (
          <ImagePool
            projectId={projectId}
            resources={resources}
            images={images}
          />
        ) : (
          <LabelSetPool
            projectId={projectId}
            labelsets={labelsets}
            onDelete={onDeleteLabelSet}
          />
        )}
      </main>

      {showUpload && (
        <UploadResourceModal
          projectId={projectId}
          initialMode={showUpload}
          onClose={() => setShowUpload(null)}
          onUploaded={() => void refresh()}
        />
      )}
      {showCreateLabelSet && (
        <CreateLabelSetModal
          projectId={projectId}
          resources={resources}
          images={images}
          onClose={() => setShowCreateLabelSet(false)}
          onCreated={(lsid) => {
            setShowCreateLabelSet(false);
            window.location.href = `/projects/${projectId}/labelsets/${lsid}`;
          }}
        />
      )}
    </div>
  );
}

// ---------------- Resource Pool ----------------

function ResourcePool({
  projectId,
  resources,
  onDelete,
}: {
  projectId: string;
  resources: ResourceSummary[];
  onDelete: (r: ResourceSummary) => Promise<void> | void;
}) {
  if (resources.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--color-line)] bg-[var(--color-surface)] p-10 text-center text-sm text-[var(--color-muted)]">
        아직 리소스가 없습니다. 상단의 “+ 동영상” 또는 “+ 이미지 묶음”으로 업로드하세요.
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-lg border border-[var(--color-line)]">
      <table className="w-full table-fixed text-sm">
        <colgroup>
          <col style={{ width: 320 }} />
          <col style={{ width: 100 }} />
          <col />
          <col style={{ width: 96 }} />
          <col style={{ width: 96 }} />
          <col style={{ width: 200 }} />
        </colgroup>
        <thead className="bg-[var(--color-surface)] text-left text-xs text-[var(--color-muted)]">
          <tr>
            <th className="px-3 py-2">Resource</th>
            <th className="px-3 py-2">Type</th>
            <th className="px-3 py-2">생성</th>
            <th className="px-3 py-2 text-right">길이</th>
            <th className="px-3 py-2 text-right">이미지</th>
            <th className="px-3 py-2 text-right">작업</th>
          </tr>
        </thead>
        <tbody>
          {resources.map((r) => (
            <ResourceRow
              key={r.id}
              projectId={projectId}
              resource={r}
              onDelete={() => void onDelete(r)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ResourceRow({
  projectId,
  resource,
  onDelete,
}: {
  projectId: string;
  resource: ResourceSummary;
  onDelete: () => void;
}) {
  const previewCount = resource.previewCount ?? 0;
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startReel = () => {
    if (previewCount <= 0) return;
    setHoverIdx(0);
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      setHoverIdx((i) => (i === null ? 0 : (i + 1) % previewCount));
    }, PREVIEW_REEL_INTERVAL_MS);
  };
  const stopReel = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setHoverIdx(null);
  };
  useEffect(
    () => () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    },
    [],
  );

  const inlineThumb =
    resource.kind === "video" && previewCount > 0
      ? previewUrl(projectId, resource.id, 0)
      : null;

  return (
    <tr className="border-t border-[var(--color-line)] bg-[var(--color-surface)]/40">
      <td className="px-3 py-2 align-top">
        <div className="flex items-start gap-2">
          {inlineThumb && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={
                hoverIdx !== null
                  ? previewUrl(projectId, resource.id, hoverIdx)
                  : inlineThumb
              }
              alt=""
              loading="lazy"
              onMouseEnter={startReel}
              onMouseLeave={stopReel}
              className="h-10 w-16 shrink-0 rounded border border-[var(--color-line)] bg-black object-cover"
            />
          )}
          <div className="min-w-0 flex-1">
            <div className="block w-full truncate font-medium" title={resource.name}>
              {resource.name}
            </div>
            <div className="truncate text-[10px] text-[var(--color-muted)]">
              {resource.width && resource.height
                ? `${resource.width}×${resource.height}`
                : "—"}
            </div>
          </div>
        </div>
      </td>
      <td className="px-3 py-2 align-top text-xs">
        <span className="rounded bg-[var(--color-surface-2)] px-1.5 py-px uppercase tracking-wide">
          {resource.kind}
        </span>
      </td>
      <td className="px-3 py-2 align-top text-[10px] text-[var(--color-muted)]">
        {new Date(resource.createdAt).toLocaleString()}
      </td>
      <td className="px-3 py-2 text-right align-top tabular-nums">
        {resource.duration ? `${resource.duration.toFixed(1)}s` : "—"}
      </td>
      <td className="px-3 py-2 text-right align-top tabular-nums">
        {resource.imageCount}
      </td>
      <td className="px-3 py-2 text-right align-top">
        <div className="flex items-center justify-end gap-2">
          {resource.kind === "video" && (
            <Link
              href={`/projects/${projectId}/resources/${resource.id}/extract`}
              className="rounded-md bg-[var(--color-accent-soft)] px-2 py-1 text-[11px] font-medium text-[var(--color-accent)]"
            >
              Frame Extraction
            </Link>
          )}
          <button
            type="button"
            onClick={onDelete}
            className="rounded-md border border-[var(--color-line)] px-2 py-1 text-[11px] text-[var(--color-muted)] hover:border-[var(--color-danger)] hover:text-[var(--color-danger)]"
          >
            삭제
          </button>
        </div>
      </td>
    </tr>
  );
}

// ---------------- Image Pool ----------------

function ImagePool({
  projectId,
  resources,
  images,
}: {
  projectId: string;
  resources: ResourceSummary[];
  images: ImageMeta[];
}) {
  const [resourceFilter, setResourceFilter] = useState<string | "all">("all");
  const [search, setSearch] = useState("");
  const [visibleCount, setVisibleCount] = useState(50);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return images.filter((im) => {
      if (resourceFilter !== "all" && im.resourceId !== resourceFilter) return false;
      if (q && !im.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [images, resourceFilter, search]);

  useEffect(() => {
    setVisibleCount(50);
  }, [resourceFilter, search]);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    if (visibleCount >= filtered.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setVisibleCount((c) => Math.min(c + 50, filtered.length));
          }
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [filtered.length, visibleCount]);

  const visible = filtered.slice(0, visibleCount);
  const resourceById = useMemo(() => {
    const m = new Map<string, ResourceSummary>();
    for (const r of resources) m.set(r.id, r);
    return m;
  }, [resources]);

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5 text-xs">
          <span className="text-[var(--color-muted)]">Resource</span>
          <select
            value={resourceFilter}
            onChange={(e) => setResourceFilter(e.target.value)}
            className="rounded border border-[var(--color-line)] bg-[var(--color-surface-2)] px-2 py-1 text-xs outline-none"
          >
            <option value="all">전체 ({images.length})</option>
            {resources.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} ({r.imageCount})
              </option>
            ))}
          </select>
        </div>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="파일명 검색"
          className="rounded border border-[var(--color-line)] bg-[var(--color-surface-2)] px-2 py-1 text-xs outline-none focus:border-[var(--color-accent)]"
        />
        <span className="ml-auto text-xs text-[var(--color-muted)]">
          {filtered.length}장 · 표시 {Math.min(visibleCount, filtered.length)}
        </span>
      </div>
      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--color-line)] bg-[var(--color-surface)] p-8 text-center text-sm text-[var(--color-muted)]">
          {images.length === 0
            ? "프로젝트에 이미지가 없습니다."
            : "조건에 맞는 이미지가 없습니다."}
        </div>
      ) : (
        <>
          <ul
            role="list"
            className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2"
          >
            {visible.map((im) => {
              const resource = resourceById.get(im.resourceId);
              return (
                <li
                  key={im.id}
                  className="overflow-hidden rounded-md border border-[var(--color-line)] bg-[var(--color-surface)]"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={imageUrl(projectId, im.id)}
                    alt={im.name}
                    loading="lazy"
                    decoding="async"
                    className="aspect-video w-full bg-black object-contain"
                  />
                  <div className="px-2 py-1 text-[11px]">
                    <div className="truncate" title={im.name}>{im.name}</div>
                    <div className="truncate text-[10px] text-[var(--color-muted)]">
                      {resource?.name ?? "—"} ·{" "}
                      {im.source === "video_frame"
                        ? typeof im.timestamp === "number"
                          ? `${im.timestamp.toFixed(2)}s`
                          : "frame"
                        : "uploaded"}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          {visibleCount < filtered.length && (
            <div
              ref={sentinelRef}
              className="mt-4 py-6 text-center text-[11px] text-[var(--color-muted)]"
            >
              더 불러오는 중… ({visibleCount} / {filtered.length})
            </div>
          )}
        </>
      )}
    </section>
  );
}

// ---------------- Label Set Pool ----------------

function LabelSetPool({
  projectId,
  labelsets,
  onDelete,
}: {
  projectId: string;
  labelsets: LabelSetSummary[];
  onDelete: (ls: LabelSetSummary) => Promise<void> | void;
}) {
  if (labelsets.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--color-line)] bg-[var(--color-surface)] p-10 text-center text-sm text-[var(--color-muted)]">
        아직 라벨셋이 없습니다. 상단의 “+ 라벨셋” 으로 이미지를 골라 라벨셋을 만드세요.
      </div>
    );
  }
  return (
    <ul role="list" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {labelsets.map((ls) => (
        <li
          key={ls.id}
          className="group flex flex-col gap-1 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-4 transition hover:border-[var(--color-accent)]/50"
        >
          <div className="flex items-start justify-between gap-2">
            <Link
              href={`/projects/${projectId}/labelsets/${ls.id}`}
              className="text-sm font-medium hover:text-[var(--color-accent)]"
            >
              {ls.name}
            </Link>
            <span className="rounded bg-[var(--color-surface-2)] px-1.5 py-px text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
              {ls.taskType}
            </span>
          </div>
          <div className="text-[11px] text-[var(--color-muted)]">
            {ls.imageIds.length} images · {ls.classCount} classes ·{" "}
            {ls.taskType === "classify"
              ? `${ls.classifiedImageCount} classified`
              : `${ls.annotationCount} annotations`}
          </div>
          <div className="text-[10px] text-[var(--color-muted)]">
            {new Date(ls.createdAt).toLocaleString()}
          </div>
          <div className="mt-2 flex justify-end gap-2">
            <a
              href={exportUrl(projectId, { labelsetIds: [ls.id] })}
              className="rounded-md border border-[var(--color-line)] px-2 py-1 text-[11px] text-[var(--color-muted)] hover:border-[var(--color-accent)] hover:text-[var(--color-text)]"
            >
              JSON
            </a>
            <button
              type="button"
              onClick={() => void onDelete(ls)}
              className="rounded-md border border-[var(--color-line)] px-2 py-1 text-[11px] text-[var(--color-muted)] hover:border-[var(--color-danger)] hover:text-[var(--color-danger)]"
            >
              삭제
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
