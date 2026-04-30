"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  bulkTagImages,
  imageBytesUrl,
} from "@/features/images/service/api";
import type { Image, ImageSource } from "@/features/images/types";
import type { ResourceSummary } from "@/features/resources/types";
import { TagInput } from "./TagInput";

const PAGE_SIZE = 100;
const NO_TAG_KEY = "__no_tag__";
// Cap each grid scroller at ~3 rows of 96px thumbnails (gap-2 = 8px). The
// pool view stays compact regardless of view mode; if more rows are needed
// the user scrolls inside the grid.
const GRID_MAX_HEIGHT = "max-h-[336px]";
// Minimum drag distance before pointerdown→up is treated as a marquee
// instead of a click. Below this we let the card's onClick fire.
const MARQUEE_THRESHOLD = 4;

type ViewMode = "all" | "by_resource" | "by_tag" | "matrix";

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
  onImagesMutated,
}: {
  projectId: string;
  images: Image[];
  resources: ResourceSummary[];
  selectedResourceId: string | null;
  selection: ImageSelection;
  onSelectionChange: (next: ImageSelection) => void;
  onStartLabeling: () => void;
  /** Called when bulk tag mutations succeed so the parent can refetch. */
  onImagesMutated?: () => void;
}) {
  const [viewMode, setViewMode] = useState<ViewMode>("all");
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [pageLimit, setPageLimit] = useState(PAGE_SIZE);
  const [bulkOpen, setBulkOpen] = useState(false);

  const allImageTags = useMemo(() => {
    const set = new Set<string>();
    for (const img of images) for (const t of img.tags) set.add(t);
    return Array.from(set).sort();
  }, [images]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return images.filter((img) => {
      if (selectedResourceId && img.resourceId !== selectedResourceId) return false;
      if (sourceFilter !== "all" && img.source !== sourceFilter) return false;
      if (tagFilter && !img.tags.includes(tagFilter)) return false;
      if (q && !img.fileName.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [images, selectedResourceId, sourceFilter, tagFilter, search]);

  // Reset pagination when the filter set changes.
  useEffect(() => {
    setPageLimit(PAGE_SIZE);
  }, [search, sourceFilter, tagFilter, selectedResourceId, viewMode]);

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

  const groupedByTag = useMemo(() => {
    if (viewMode !== "by_tag") return null;
    const map = new Map<string, Image[]>();
    for (const img of filtered) {
      if (img.tags.length === 0) {
        const arr = map.get(NO_TAG_KEY) ?? [];
        arr.push(img);
        map.set(NO_TAG_KEY, arr);
      } else {
        for (const tag of img.tags) {
          const arr = map.get(tag) ?? [];
          arr.push(img);
          map.set(tag, arr);
        }
      }
    }
    const entries = Array.from(map.entries()).map(([tag, imgs]) => ({
      tag,
      images: imgs,
    }));
    // (no tag) bucket sinks to the bottom; named tags in alpha order otherwise.
    entries.sort((a, b) => {
      if (a.tag === NO_TAG_KEY) return 1;
      if (b.tag === NO_TAG_KEY) return -1;
      return a.tag.localeCompare(b.tag);
    });
    return entries;
  }, [filtered, viewMode]);

  const matrix = useMemo(() => {
    if (viewMode !== "matrix") return null;
    // Rows = tags found on the *filtered* image set (so cells reflect what
    // the user is currently looking at). Columns = resources that contributed
    // to that filtered set, in createdAt order.
    const tagSet = new Set<string>();
    let untaggedCount = 0;
    const resourceUse = new Map<string, number>();
    for (const img of filtered) {
      resourceUse.set(img.resourceId, (resourceUse.get(img.resourceId) ?? 0) + 1);
      if (img.tags.length === 0) untaggedCount += 1;
      for (const t of img.tags) tagSet.add(t);
    }
    const rowTags = Array.from(tagSet).sort();
    if (untaggedCount > 0) rowTags.push(NO_TAG_KEY);
    const cols = Array.from(resourceUse.keys())
      .map((rid) => resourceById.get(rid))
      .filter((r): r is ResourceSummary => r != null)
      .sort((a, b) => a.createdAt - b.createdAt);
    // (tag, resource) → matching image ids
    const cellIds = new Map<string, string[]>();
    for (const img of filtered) {
      const tags = img.tags.length === 0 ? [NO_TAG_KEY] : img.tags;
      for (const tag of tags) {
        const key = `${tag}::${img.resourceId}`;
        const arr = cellIds.get(key) ?? [];
        arr.push(img.id);
        cellIds.set(key, arr);
      }
    }
    return { rowTags, cols, cellIds };
  }, [filtered, viewMode, resourceById]);

  const toggle = (id: string) => {
    const next = new Set(selection.ids);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectionChange({ ids: next });
  };

  const selectIds = (ids: string[], add: boolean) => {
    const next = new Set(selection.ids);
    if (add) for (const id of ids) next.add(id);
    else for (const id of ids) next.delete(id);
    onSelectionChange({ ids: next });
  };

  const selectVisible = () => selectIds(visible.map((i) => i.id), true);
  const selectAllResults = () => selectIds(filtered.map((i) => i.id), true);
  const clearSelection = () => onSelectionChange({ ids: new Set() });

  /**
   * Marquee batch behavior: if any image inside the box is currently
   * unselected, select the whole box; otherwise (every image is already
   * selected) deselect the whole box. Empty boxes are no-ops.
   */
  const marqueeBatchToggle = useCallback(
    (idsInBox: string[]) => {
      if (idsInBox.length === 0) return;
      const allSelected = idsInBox.every((id) => selection.ids.has(id));
      const next = new Set(selection.ids);
      if (allSelected) {
        for (const id of idsInBox) next.delete(id);
      } else {
        for (const id of idsInBox) next.add(id);
      }
      onSelectionChange({ ids: next });
    },
    [selection.ids, onSelectionChange],
  );

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
            {tagFilter && <span className="ml-1">· tag: {tagFilter}</span>}
          </p>
        </div>
        <div className="flex items-center gap-1 text-[11px]">
          <ViewModeChip active={viewMode === "all"} onClick={() => setViewMode("all")}>
            All
          </ViewModeChip>
          <ViewModeChip
            active={viewMode === "by_resource"}
            onClick={() => setViewMode("by_resource")}
          >
            By Resource
          </ViewModeChip>
          <ViewModeChip
            active={viewMode === "by_tag"}
            onClick={() => setViewMode("by_tag")}
          >
            By Tag
          </ViewModeChip>
          <ViewModeChip
            active={viewMode === "matrix"}
            onClick={() => setViewMode("matrix")}
          >
            Resource × Tag
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

      {allImageTags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 border-b border-[var(--color-line)] px-3 py-1.5 text-[11px]">
          <span className="mr-1 text-[var(--color-muted)]">image tags:</span>
          <ViewModeChip active={tagFilter === null} onClick={() => setTagFilter(null)}>
            전체
          </ViewModeChip>
          {allImageTags.map((t) => (
            <ViewModeChip
              key={t}
              active={tagFilter === t}
              onClick={() => setTagFilter(tagFilter === t ? null : t)}
            >
              {t}
            </ViewModeChip>
          ))}
        </div>
      )}

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
          onClick={() => setBulkOpen((v) => !v)}
          disabled={selection.ids.size === 0}
          className="rounded-md border border-[var(--color-line)] px-2 py-0.5 disabled:opacity-40 hover:border-[var(--color-accent)]"
        >
          태그 일괄…
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

      {bulkOpen && selection.ids.size > 0 && (
        <BulkTagBar
          projectId={projectId}
          imageIds={Array.from(selection.ids)}
          onClose={() => setBulkOpen(false)}
          onMutated={() => onImagesMutated?.()}
        />
      )}

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
            onMarqueeBatchToggle={marqueeBatchToggle}
          />
        ) : viewMode === "by_resource" ? (
          <div className="space-y-4">
            {groupedByResource?.map((group) => (
              <ByResourceGroup
                key={group.resource?.id ?? "?"}
                projectId={projectId}
                resource={group.resource}
                images={group.images.slice(0, pageLimit)}
                selection={selection}
                onToggle={toggle}
                onSelectAll={() => selectIds(group.images.map((i) => i.id), true)}
                onMarqueeBatchToggle={marqueeBatchToggle}
              />
            ))}
          </div>
        ) : viewMode === "by_tag" ? (
          <div className="space-y-4">
            {groupedByTag?.map((group) => (
              <ByTagGroup
                key={group.tag}
                projectId={projectId}
                tag={group.tag}
                images={group.images.slice(0, pageLimit)}
                totalCount={group.images.length}
                selection={selection}
                onToggle={toggle}
                onSelectAll={() => selectIds(group.images.map((i) => i.id), true)}
                onMarqueeBatchToggle={marqueeBatchToggle}
              />
            ))}
          </div>
        ) : (
          <MatrixView
            matrix={matrix!}
            selection={selection}
            onSelectCell={(ids, add) => selectIds(ids, add)}
          />
        )}

        {hasMore && viewMode !== "matrix" && (
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
  onMarqueeBatchToggle,
}: {
  projectId: string;
  images: Image[];
  selection: ImageSelection;
  onToggle: (id: string) => void;
  /**
   * Called when the user releases a marquee-drag. Receives the ids inside
   * the box. The pool decides batch behavior (currently: if any of the box
   * is unselected, select all; otherwise deselect all).
   */
  onMarqueeBatchToggle: (idsInBox: string[]) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Marquee position is stored in scroll-content coords (i.e. it includes
  // scrollTop/scrollLeft) so the absolute-positioned overlay stays glued to
  // the dragged region even if the user scrolls during the drag.
  const [marquee, setMarquee] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const clickGuardRef = useRef(false);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const startX = e.clientX - rect.left + el.scrollLeft;
      const startY = e.clientY - rect.top + el.scrollTop;
      // We deliberately do NOT call setPointerCapture here. Capturing on
      // the container would redirect pointerup → click events to the
      // container instead of the underlying card button, breaking single
      // click toggle. Document-level listeners give us the same "track
      // even if pointer leaves the container" guarantee without that.
      let dragged = false;

      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== e.pointerId) return;
        const r = el.getBoundingClientRect();
        const curX = ev.clientX - r.left + el.scrollLeft;
        const curY = ev.clientY - r.top + el.scrollTop;
        if (!dragged) {
          if (
            Math.hypot(curX - startX, curY - startY) < MARQUEE_THRESHOLD
          ) {
            return;
          }
          dragged = true;
        }
        setMarquee({
          left: Math.min(startX, curX),
          top: Math.min(startY, curY),
          width: Math.abs(curX - startX),
          height: Math.abs(curY - startY),
        });
      };

      const onUp = (ev: PointerEvent) => {
        if (ev.pointerId !== e.pointerId) return;
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        document.removeEventListener("pointercancel", onUp);
        if (!dragged) {
          // Below the movement threshold: real click — let the card's
          // onClick fire normally.
          return;
        }
        const r = el.getBoundingClientRect();
        const curX = ev.clientX - r.left + el.scrollLeft;
        const curY = ev.clientY - r.top + el.scrollTop;
        const ax = Math.min(startX, curX);
        const ay = Math.min(startY, curY);
        const bx = Math.max(startX, curX);
        const by = Math.max(startY, curY);
        // Hit-test cards via their content-box coordinates inside the
        // scroll container, so cards currently outside the visible
        // viewport (but inside the marquee) still register.
        const hits: string[] = [];
        const cards = el.querySelectorAll<HTMLElement>("[data-image-id]");
        cards.forEach((card) => {
          const cr = card.getBoundingClientRect();
          const cAx = cr.left - r.left + el.scrollLeft;
          const cAy = cr.top - r.top + el.scrollTop;
          const cBx = cAx + cr.width;
          const cBy = cAy + cr.height;
          if (cBx < ax || cAx > bx || cBy < ay || cAy > by) return;
          const id = card.dataset.imageId;
          if (id) hits.push(id);
        });
        if (hits.length > 0) onMarqueeBatchToggle(hits);
        // Swallow the click that the browser will synthesize on the
        // pointerdown target so the drag doesn't also flip that single
        // card's selection.
        clickGuardRef.current = true;
        setMarquee(null);
      };

      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
      document.addEventListener("pointercancel", onUp);
    },
    [onMarqueeBatchToggle],
  );

  const onClickCapture = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (clickGuardRef.current) {
      e.preventDefault();
      e.stopPropagation();
      clickGuardRef.current = false;
    }
  }, []);

  return (
    <div
      ref={containerRef}
      onPointerDown={onPointerDown}
      onClickCapture={onClickCapture}
      className={`relative overflow-y-auto ${GRID_MAX_HEIGHT} select-none`}
    >
      <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2 p-0.5">
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
      {marquee && (
        <div
          aria-hidden
          className="pointer-events-none absolute rounded-sm border border-[var(--color-accent)] bg-[var(--color-accent)]/15"
          style={{
            left: marquee.left,
            top: marquee.top,
            width: marquee.width,
            height: marquee.height,
          }}
        />
      )}
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
      data-image-id={image.id}
      onClick={onToggle}
      onDragStart={(e) => e.preventDefault()}
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
          decoding="async"
          draggable={false}
          className="pointer-events-none h-full w-full object-cover select-none"
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
      {image.tags.length > 0 && (
        <div className="pointer-events-none absolute right-1 top-1 rounded bg-[var(--color-accent)]/90 px-1 text-[9px] font-medium text-black">
          {image.tags.length}
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
  onSelectAll,
  onMarqueeBatchToggle,
}: {
  projectId: string;
  resource: ResourceSummary | undefined;
  images: Image[];
  selection: ImageSelection;
  onToggle: (id: string) => void;
  onSelectAll: () => void;
  onMarqueeBatchToggle: (idsInBox: string[]) => void;
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
        <button
          type="button"
          onClick={onSelectAll}
          className="ml-auto rounded-md border border-[var(--color-line)] px-2 py-0.5 text-[10px] hover:border-[var(--color-accent)]"
        >
          이 그룹 전체 선택
        </button>
      </div>
      <div className="ml-2 border-l border-[var(--color-line)] pl-3">
        <ImageGrid
          projectId={projectId}
          images={images}
          selection={selection}
          onToggle={onToggle}
          onMarqueeBatchToggle={onMarqueeBatchToggle}
        />
      </div>
    </div>
  );
}

function ByTagGroup({
  projectId,
  tag,
  images,
  totalCount,
  selection,
  onToggle,
  onSelectAll,
  onMarqueeBatchToggle,
}: {
  projectId: string;
  tag: string;
  images: Image[];
  totalCount: number;
  selection: ImageSelection;
  onToggle: (id: string) => void;
  onSelectAll: () => void;
  onMarqueeBatchToggle: (idsInBox: string[]) => void;
}) {
  const isUntagged = tag === NO_TAG_KEY;
  return (
    <div>
      <div className="mb-2 flex items-baseline gap-2">
        <span
          className={[
            "rounded-full px-2 py-0.5 text-[11px]",
            isUntagged
              ? "bg-[var(--color-surface-2)] text-[var(--color-muted)]"
              : "bg-[var(--color-accent-soft)] text-[var(--color-accent)]",
          ].join(" ")}
        >
          {isUntagged ? "(no tag)" : tag}
        </span>
        <span className="text-[10px] text-[var(--color-muted)]">
          {totalCount} images
        </span>
        <button
          type="button"
          onClick={onSelectAll}
          className="ml-auto rounded-md border border-[var(--color-line)] px-2 py-0.5 text-[10px] hover:border-[var(--color-accent)]"
        >
          이 그룹 전체 선택
        </button>
      </div>
      <div className="ml-2 border-l border-[var(--color-line)] pl-3">
        <ImageGrid
          projectId={projectId}
          images={images}
          selection={selection}
          onToggle={onToggle}
          onMarqueeBatchToggle={onMarqueeBatchToggle}
        />
      </div>
    </div>
  );
}

function MatrixView({
  matrix,
  selection,
  onSelectCell,
}: {
  matrix: {
    rowTags: string[];
    cols: ResourceSummary[];
    cellIds: Map<string, string[]>;
  };
  selection: ImageSelection;
  onSelectCell: (ids: string[], add: boolean) => void;
}) {
  const { rowTags, cols, cellIds } = matrix;
  if (rowTags.length === 0 || cols.length === 0) {
    return (
      <div className="py-6 text-center text-xs text-[var(--color-muted)]">
        매트릭스로 표시할 (resource, tag) 조합이 없습니다.
      </div>
    );
  }
  return (
    <div className={`overflow-auto ${GRID_MAX_HEIGHT}`}>
      <table className="w-full text-[11px]">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 bg-[var(--color-surface)] px-2 py-1 text-left text-[var(--color-muted)]">
              tag \ resource
            </th>
            {cols.map((r) => (
              <th
                key={r.id}
                className="px-2 py-1 text-left font-normal text-[var(--color-muted)]"
                title={r.name}
              >
                <div className="max-w-[140px] truncate">{r.name}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rowTags.map((tag) => (
            <tr key={tag} className="border-t border-[var(--color-line)]">
              <th
                scope="row"
                className="sticky left-0 z-10 bg-[var(--color-surface)] px-2 py-1 text-left font-normal"
              >
                <span
                  className={
                    tag === NO_TAG_KEY
                      ? "text-[var(--color-muted)]"
                      : "text-[var(--color-text)]"
                  }
                >
                  {tag === NO_TAG_KEY ? "(no tag)" : tag}
                </span>
              </th>
              {cols.map((r) => {
                const ids = cellIds.get(`${tag}::${r.id}`) ?? [];
                if (ids.length === 0) {
                  return (
                    <td key={r.id} className="px-2 py-1 text-[var(--color-muted)]">
                      —
                    </td>
                  );
                }
                const allSelected = ids.every((id) => selection.ids.has(id));
                return (
                  <td key={r.id} className="px-2 py-1">
                    <button
                      type="button"
                      onClick={() => onSelectCell(ids, !allSelected)}
                      title={allSelected ? "선택 해제" : "이 셀 선택"}
                      className={[
                        "min-w-[3rem] rounded px-2 py-0.5 text-left transition",
                        allSelected
                          ? "bg-[var(--color-accent)] text-black"
                          : "bg-[var(--color-surface-2)] hover:bg-[var(--color-accent-soft)] hover:text-[var(--color-accent)]",
                      ].join(" ")}
                    >
                      {ids.length}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BulkTagBar({
  projectId,
  imageIds,
  onClose,
  onMutated,
}: {
  projectId: string;
  imageIds: string[];
  onClose: () => void;
  onMutated: () => void;
}) {
  const [tags, setTags] = useState<string[]>([]);
  const [busy, setBusy] = useState<null | "add" | "remove" | "replace">(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const lastFeedbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const apply = async (mode: "add" | "remove" | "replace") => {
    if (busy) return;
    if (mode !== "replace" && tags.length === 0) {
      setFeedback("적용할 태그를 입력하세요.");
      return;
    }
    setBusy(mode);
    setFeedback(null);
    try {
      const { updated } = await bulkTagImages(projectId, imageIds, tags, mode);
      setFeedback(`${updated}장 갱신 완료`);
      onMutated();
      if (lastFeedbackRef.current) clearTimeout(lastFeedbackRef.current);
      lastFeedbackRef.current = setTimeout(() => setFeedback(null), 2000);
    } catch (e) {
      setFeedback(e instanceof Error ? e.message : "실패");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-line)] bg-[var(--color-surface-2)]/40 px-3 py-2 text-[11px]">
      <span className="text-[var(--color-muted)]">
        {imageIds.length}장에 적용:
      </span>
      <div className="min-w-[200px] flex-1">
        <TagInput value={tags} onChange={setTags} disabled={busy != null} />
      </div>
      <button
        type="button"
        onClick={() => void apply("add")}
        disabled={busy != null}
        className="rounded-md bg-[var(--color-accent)] px-2 py-0.5 font-medium text-black disabled:opacity-40"
      >
        {busy === "add" ? "추가 중…" : "추가"}
      </button>
      <button
        type="button"
        onClick={() => void apply("remove")}
        disabled={busy != null}
        className="rounded-md border border-[var(--color-line)] px-2 py-0.5 disabled:opacity-40 hover:border-[var(--color-accent)]"
      >
        {busy === "remove" ? "제거 중…" : "제거"}
      </button>
      <button
        type="button"
        onClick={() => void apply("replace")}
        disabled={busy != null}
        className="rounded-md border border-[var(--color-line)] px-2 py-0.5 disabled:opacity-40 hover:border-[var(--color-danger)] hover:text-[var(--color-danger)]"
        title="이미지의 모든 기존 태그를 위 입력으로 대체"
      >
        {busy === "replace" ? "교체 중…" : "교체"}
      </button>
      {feedback && <span className="text-[var(--color-muted)]">{feedback}</span>}
      <button
        type="button"
        onClick={onClose}
        disabled={busy != null}
        className="ml-auto text-[var(--color-muted)] hover:text-[var(--color-text)]"
      >
        닫기
      </button>
    </div>
  );
}
