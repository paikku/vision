"use client";

import { useEffect, useMemo, useState } from "react";
import { imageBytesUrl } from "@/features/images/service/api";
import type { Image, ImageSource } from "@/features/images/types";
import type { ResourceSummary } from "@/features/resources/types";

const PAGE_SIZE = 100;

type ViewMode = "all" | "by_resource";

type SourceFilter = "all" | ImageSource;

export type ImageSelection = {
  ids: Set<string>;
};

export function ImagePool({
  projectId,
  images,
  resources,
  selectedResourceId,
  selection,
  onSelectionChange,
  onStartLabeling,
}: {
  projectId: string;
  images: Image[];
  resources: ResourceSummary[];
  selectedResourceId: string | null;
  selection: ImageSelection;
  onSelectionChange: (next: ImageSelection) => void;
  onStartLabeling: () => void;
}) {
  const [viewMode, setViewMode] = useState<ViewMode>("all");
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [pageLimit, setPageLimit] = useState(PAGE_SIZE);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return images.filter((img) => {
      if (selectedResourceId && img.resourceId !== selectedResourceId) return false;
      if (sourceFilter !== "all" && img.source !== sourceFilter) return false;
      if (q && !img.fileName.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [images, selectedResourceId, sourceFilter, search]);

  // Reset pagination when the filter set changes.
  useEffect(() => {
    setPageLimit(PAGE_SIZE);
  }, [search, sourceFilter, selectedResourceId, viewMode]);

  const visible = filtered.slice(0, pageLimit);
  const hasMore = filtered.length > pageLimit;

  const resourceById = useMemo(() => {
    const map = new Map<string, ResourceSummary>();
    for (const r of resources) map.set(r.id, r);
    return map;
  }, [resources]);

  const groupedByResource = useMemo(() => {
    if (viewMode !== "by_resource") return null;
    const map = new Map<string, Image[]>();
    for (const img of filtered) {
      const arr = map.get(img.resourceId) ?? [];
      arr.push(img);
      map.set(img.resourceId, arr);
    }
    return Array.from(map.entries()).map(([rid, imgs]) => ({
      resource: resourceById.get(rid),
      images: imgs,
    }));
  }, [filtered, viewMode, resourceById]);

  const toggle = (id: string) => {
    const next = new Set(selection.ids);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectionChange({ ids: next });
  };

  const selectVisible = () => {
    const next = new Set(selection.ids);
    for (const img of visible) next.add(img.id);
    onSelectionChange({ ids: next });
  };
  const selectAllResults = () => {
    const next = new Set(selection.ids);
    for (const img of filtered) next.add(img.id);
    onSelectionChange({ ids: next });
  };
  const clearSelection = () => {
    onSelectionChange({ ids: new Set() });
  };

  return (
    <section className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)]">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-line)] px-3 py-2">
        <div>
          <h2 className="text-xs font-semibold tracking-tight">Image Pool</h2>
          <p className="mt-0.5 text-[11px] text-[var(--color-muted)]">
            {filtered.length === images.length
              ? `${images.length} images`
              : `${filtered.length} / ${images.length} images`}
            {selectedResourceId && (
              <span className="ml-1">
                · resource: {resourceById.get(selectedResourceId)?.name ?? selectedResourceId}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-1 text-[11px]">
          <ViewModeChip active={viewMode === "all"} onClick={() => setViewMode("all")}>
            All Images
          </ViewModeChip>
          <ViewModeChip
            active={viewMode === "by_resource"}
            onClick={() => setViewMode("by_resource")}
          >
            By Resource
          </ViewModeChip>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-line)] px-3 py-2 text-xs">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="파일명 검색"
          className="min-w-[160px] flex-1 rounded-md bg-[var(--color-surface-2)] px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
        />
        <ViewModeChip
          active={sourceFilter === "all"}
          onClick={() => setSourceFilter("all")}
        >
          모두
        </ViewModeChip>
        <ViewModeChip
          active={sourceFilter === "uploaded"}
          onClick={() => setSourceFilter("uploaded")}
        >
          업로드
        </ViewModeChip>
        <ViewModeChip
          active={sourceFilter === "video_frame"}
          onClick={() => setSourceFilter("video_frame")}
        >
          비디오 프레임
        </ViewModeChip>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-line)] px-3 py-2 text-[11px]">
        <span className="text-[var(--color-muted)]">선택: {selection.ids.size}</span>
        <button
          type="button"
          onClick={selectVisible}
          className="rounded-md border border-[var(--color-line)] px-2 py-0.5 hover:border-[var(--color-accent)]"
        >
          현재 페이지 전체 선택
        </button>
        <button
          type="button"
          onClick={selectAllResults}
          className="rounded-md border border-[var(--color-line)] px-2 py-0.5 hover:border-[var(--color-accent)]"
        >
          현재 결과 전체 선택 ({filtered.length})
        </button>
        <button
          type="button"
          onClick={clearSelection}
          disabled={selection.ids.size === 0}
          className="rounded-md border border-[var(--color-line)] px-2 py-0.5 disabled:opacity-40 hover:border-[var(--color-line)]"
        >
          선택 해제
        </button>
        <button
          type="button"
          onClick={onStartLabeling}
          disabled={selection.ids.size === 0}
          className="ml-auto rounded-md bg-[var(--color-accent)] px-2.5 py-1 font-medium text-black disabled:opacity-40"
        >
          Start Labeling
        </button>
      </div>

      <div className="px-3 py-3">
        {filtered.length === 0 ? (
          <div className="py-10 text-center text-xs text-[var(--color-muted)]">
            {images.length === 0
              ? "이미지가 없습니다. Resource 를 업로드하거나 Frame Extraction 을 진행하세요."
              : "조건에 맞는 이미지가 없습니다."}
          </div>
        ) : viewMode === "all" ? (
          <ImageGrid
            projectId={projectId}
            images={visible}
            selection={selection}
            onToggle={toggle}
          />
        ) : (
          <div className="space-y-4">
            {groupedByResource?.map((group) => (
              <ByResourceGroup
                key={group.resource?.id ?? "?"}
                projectId={projectId}
                resource={group.resource}
                images={group.images.slice(0, pageLimit)}
                selection={selection}
                onToggle={toggle}
              />
            ))}
          </div>
        )}

        {hasMore && (
          <div className="mt-3 text-center">
            <button
              type="button"
              onClick={() => setPageLimit((n) => n + PAGE_SIZE)}
              className="rounded-md border border-[var(--color-line)] px-3 py-1 text-xs hover:border-[var(--color-accent)]"
            >
              더 보기 ({filtered.length - pageLimit} 남음)
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function ViewModeChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "rounded-full px-2 py-0.5 text-[11px] transition",
        active
          ? "bg-[var(--color-accent)] text-black"
          : "bg-[var(--color-surface-2)] text-[var(--color-muted)] hover:text-[var(--color-text)]",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function ImageGrid({
  projectId,
  images,
  selection,
  onToggle,
}: {
  projectId: string;
  images: Image[];
  selection: ImageSelection;
  onToggle: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2">
      {images.map((img) => (
        <ImageCard
          key={img.id}
          projectId={projectId}
          image={img}
          selected={selection.ids.has(img.id)}
          onToggle={() => onToggle(img.id)}
        />
      ))}
    </div>
  );
}

function ImageCard({
  projectId,
  image,
  selected,
  onToggle,
}: {
  projectId: string;
  image: Image;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      title={image.fileName}
      className={[
        "group relative overflow-hidden rounded-md border bg-black transition",
        selected
          ? "border-[var(--color-accent)] ring-2 ring-[var(--color-accent)]"
          : "border-[var(--color-line)] hover:border-[var(--color-accent)]/60",
      ].join(" ")}
    >
      <div className="aspect-square w-full">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageBytesUrl(projectId, image.id)}
          alt={image.fileName}
          loading="lazy"
          className="h-full w-full object-cover"
        />
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/80 to-transparent px-1.5 py-1 text-left text-[10px] text-white">
        {image.fileName}
      </div>
      {image.source === "video_frame" && (
        <div className="pointer-events-none absolute left-1 top-1 rounded bg-black/60 px-1 text-[9px] text-white">
          frame
        </div>
      )}
    </button>
  );
}

function ByResourceGroup({
  projectId,
  resource,
  images,
  selection,
  onToggle,
}: {
  projectId: string;
  resource: ResourceSummary | undefined;
  images: Image[];
  selection: ImageSelection;
  onToggle: (id: string) => void;
}) {
  return (
    <div>
      <div className="mb-2 flex items-baseline gap-2">
        <span className="text-xs font-medium">
          {resource?.name ?? "(unknown resource)"}
        </span>
        <span className="text-[10px] text-[var(--color-muted)]">
          {resource?.type === "video" ? "video" : "image_batch"} · {images.length} images
        </span>
        {resource && resource.tags.length > 0 && (
          <span className="flex items-center gap-1">
            {resource.tags.map((t) => (
              <span
                key={t}
                className="rounded-full bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[10px] text-[var(--color-muted)]"
              >
                {t}
              </span>
            ))}
          </span>
        )}
      </div>
      <ImageGrid
        projectId={projectId}
        images={images}
        selection={selection}
        onToggle={onToggle}
      />
    </div>
  );
}
