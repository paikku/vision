"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  deleteResource as apiDeleteResource,
  resourcePreviewUrl,
  updateResource,
} from "@/features/resources/service/api";
import type {
  ResourceSummary,
  ResourceType,
} from "@/features/resources/types";

const PREVIEW_REEL_INTERVAL_MS = 220;
// Minimum drag distance before pointerdown→up is treated as a marquee
// instead of a click. Mirrors ImagePool::MARQUEE_THRESHOLD (§12.2).
const MARQUEE_THRESHOLD = 4;

type TypeFilter = "all" | ResourceType;

export type ResourceSelection = {
  resourceIds: Set<string>;
};

export function ResourcePool({
  projectId,
  resources,
  reload,
  selection,
  onSelect,
}: {
  projectId: string;
  resources: ResourceSummary[];
  reload: () => Promise<void>;
  selection: ResourceSelection;
  onSelect: (sel: ResourceSelection) => void;
}) {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [editingNameId, setEditingNameId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return resources.filter((r) => {
      if (typeFilter !== "all" && r.type !== typeFilter) return false;
      if (q && !r.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [resources, search, typeFilter]);

  const filteredIds = useMemo(() => filtered.map((r) => r.id), [filtered]);

  const lastClickedIdRef = useRef<string | null>(null);
  const containerRef = useRef<HTMLUListElement>(null);
  const clickGuardRef = useRef(false);
  const [marquee, setMarquee] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);

  const setSelectionIds = useCallback(
    (ids: Set<string>) => {
      onSelect({ resourceIds: ids });
    },
    [onSelect],
  );

  const toggleOne = useCallback(
    (id: string) => {
      const next = new Set(selection.resourceIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      lastClickedIdRef.current = id;
      setSelectionIds(next);
    },
    [selection.resourceIds, setSelectionIds],
  );

  const selectRange = useCallback(
    (id: string) => {
      const anchor = lastClickedIdRef.current;
      if (!anchor || anchor === id) {
        toggleOne(id);
        return;
      }
      const ai = filteredIds.indexOf(anchor);
      const bi = filteredIds.indexOf(id);
      if (ai < 0 || bi < 0) {
        toggleOne(id);
        return;
      }
      const [lo, hi] = ai <= bi ? [ai, bi] : [bi, ai];
      const next = new Set(selection.resourceIds);
      for (let i = lo; i <= hi; i++) next.add(filteredIds[i]);
      lastClickedIdRef.current = id;
      setSelectionIds(next);
    },
    [filteredIds, selection.resourceIds, setSelectionIds, toggleOne],
  );

  const marqueeBatchToggle = useCallback(
    (idsInBox: string[]) => {
      if (idsInBox.length === 0) return;
      const allSelected = idsInBox.every((id) => selection.resourceIds.has(id));
      const next = new Set(selection.resourceIds);
      if (allSelected) {
        for (const id of idsInBox) next.delete(id);
      } else {
        for (const id of idsInBox) next.add(id);
      }
      setSelectionIds(next);
    },
    [selection.resourceIds, setSelectionIds],
  );

  // Marquee on the row container. Mirrors ImagePool's pattern (§12.2):
  // no setPointerCapture, document listeners, click guard for synthetic
  // click after drag.
  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLUListElement>) => {
      if (e.button !== 0) return;
      // Don't start a marquee when the user clicks an interactive child
      // (action button, input, link).
      const target = e.target as HTMLElement;
      if (target.closest("[data-row-action]")) return;
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const startX = e.clientX - rect.left + el.scrollLeft;
      const startY = e.clientY - rect.top + el.scrollTop;
      let dragged = false;

      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== e.pointerId) return;
        const r = el.getBoundingClientRect();
        const curX = ev.clientX - r.left + el.scrollLeft;
        const curY = ev.clientY - r.top + el.scrollTop;
        if (!dragged) {
          if (Math.hypot(curX - startX, curY - startY) < MARQUEE_THRESHOLD) {
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
        if (!dragged) return;
        const r = el.getBoundingClientRect();
        const curX = ev.clientX - r.left + el.scrollLeft;
        const curY = ev.clientY - r.top + el.scrollTop;
        const ax = Math.min(startX, curX);
        const ay = Math.min(startY, curY);
        const bx = Math.max(startX, curX);
        const by = Math.max(startY, curY);
        const hits: string[] = [];
        const rows = el.querySelectorAll<HTMLElement>("[data-resource-id]");
        rows.forEach((row) => {
          const cr = row.getBoundingClientRect();
          const cAx = cr.left - r.left + el.scrollLeft;
          const cAy = cr.top - r.top + el.scrollTop;
          const cBx = cAx + cr.width;
          const cBy = cAy + cr.height;
          if (cBx < ax || cAx > bx || cBy < ay || cAy > by) return;
          const id = row.dataset.resourceId;
          if (id) hits.push(id);
        });
        if (hits.length > 0) marqueeBatchToggle(hits);
        clickGuardRef.current = true;
        setMarquee(null);
      };

      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
      document.addEventListener("pointercancel", onUp);
    },
    [marqueeBatchToggle],
  );

  const onClickCapture = useCallback((e: React.MouseEvent<HTMLUListElement>) => {
    if (clickGuardRef.current) {
      e.preventDefault();
      e.stopPropagation();
      clickGuardRef.current = false;
    }
  }, []);

  // Close ⋯ menu on outside click / Escape.
  useEffect(() => {
    if (!openMenuId) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("[data-row-menu]")) return;
      setOpenMenuId(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenMenuId(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [openMenuId]);

  const onDelete = async (r: ResourceSummary) => {
    if (
      !confirm(
        `Resource "${r.name}" 을(를) 삭제하시겠습니까?\n포함된 ${r.imageCount}장의 이미지도 함께 삭제됩니다.`,
      )
    ) {
      return;
    }
    await apiDeleteResource(projectId, r.id);
    if (selection.resourceIds.has(r.id)) {
      const next = new Set(selection.resourceIds);
      next.delete(r.id);
      setSelectionIds(next);
    }
    await reload();
  };

  const onBulkDelete = async () => {
    const targets = resources.filter((r) => selection.resourceIds.has(r.id));
    if (targets.length === 0) return;
    const totalImages = targets.reduce((s, r) => s + r.imageCount, 0);
    if (
      !confirm(
        `${targets.length}개 Resource 를 삭제합니다.\n포함된 ${totalImages}장의 이미지도 함께 삭제됩니다.`,
      )
    ) {
      return;
    }
    for (const r of targets) {
      await apiDeleteResource(projectId, r.id);
    }
    setSelectionIds(new Set());
    await reload();
  };

  const startRename = (r: ResourceSummary) => {
    setEditingNameId(r.id);
    setDraftName(r.name);
    setOpenMenuId(null);
  };

  const commitRename = async (r: ResourceSummary) => {
    const next = draftName.trim();
    setEditingNameId(null);
    if (!next || next === r.name) return;
    await updateResource(projectId, r.id, { name: next });
    await reload();
  };

  const selectedCount = selection.resourceIds.size;

  return (
    <section className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)]">
      <header className="flex flex-wrap items-center gap-2 border-b border-[var(--color-line)] px-3 py-2">
        <div>
          <h2 className="text-xs font-semibold tracking-tight">Resource Pool</h2>
          <p className="mt-0.5 text-[11px] text-[var(--color-muted)]">
            업로드 묶음 단위로 자료를 관리합니다.
          </p>
        </div>
        {selectedCount > 0 && (
          <div className="ml-auto flex items-center gap-2 rounded-md bg-[var(--color-accent-soft)] px-2 py-1 text-[11px]">
            <span className="font-medium text-[var(--color-accent)]">
              {selectedCount}개 선택됨
            </span>
            <button
              type="button"
              onClick={() => setSelectionIds(new Set())}
              className="rounded border border-[var(--color-line)] bg-[var(--color-surface)] px-1.5 py-0 hover:border-[var(--color-line)]"
            >
              해제
            </button>
            <button
              type="button"
              onClick={() => void onBulkDelete()}
              className="rounded border border-[var(--color-line)] bg-[var(--color-surface)] px-1.5 py-0 hover:border-[var(--color-danger)] hover:text-[var(--color-danger)]"
            >
              일괄 삭제
            </button>
          </div>
        )}
      </header>

      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-line)] px-3 py-2 text-xs">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="이름 검색"
          className="min-w-[160px] flex-1 rounded-md bg-[var(--color-surface-2)] px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
        />
        <FilterChip
          active={typeFilter === "all"}
          onClick={() => setTypeFilter("all")}
        >
          All
        </FilterChip>
        <FilterChip
          active={typeFilter === "video"}
          onClick={() => setTypeFilter("video")}
        >
          Video
        </FilterChip>
        <FilterChip
          active={typeFilter === "image_batch"}
          onClick={() => setTypeFilter("image_batch")}
        >
          Image Batch
        </FilterChip>
      </div>

      {filtered.length === 0 ? (
        <div className="px-3 py-6 text-center text-xs text-[var(--color-muted)]">
          {resources.length === 0
            ? "Resource 가 없습니다. 상단에서 업로드하세요."
            : "조건에 맞는 Resource 가 없습니다."}
        </div>
      ) : (
        <ul
          ref={containerRef}
          onPointerDown={onPointerDown}
          onClickCapture={onClickCapture}
          className="relative divide-y divide-[var(--color-line)] select-none"
        >
          {filtered.map((r) => {
            const selected = selection.resourceIds.has(r.id);
            return (
              <li
                key={r.id}
                data-resource-id={r.id}
                onClick={(e) => {
                  // Ignore clicks that originated on action elements.
                  const target = e.target as HTMLElement;
                  if (target.closest("[data-row-action]")) return;
                  if (e.shiftKey) selectRange(r.id);
                  else toggleOne(r.id);
                }}
                className={[
                  "flex items-start gap-2 px-3 py-2 text-xs transition cursor-pointer",
                  selected
                    ? "bg-[var(--color-accent-soft)]"
                    : "hover:bg-[var(--color-surface-2)]",
                ].join(" ")}
              >
                <div
                  aria-hidden
                  className={[
                    "mt-0.5 h-3.5 w-3.5 shrink-0 rounded border transition",
                    selected
                      ? "border-[var(--color-accent)] bg-[var(--color-accent)]"
                      : "border-[var(--color-line)]",
                  ].join(" ")}
                />

                {r.type === "video" && (r.previewCount ?? 0) > 0 ? (
                  <PreviewReel
                    projectId={projectId}
                    resource={r}
                    extractHref={`/projects/${projectId}/extract/${r.id}`}
                  />
                ) : (
                  <ResourceTypeBadge type={r.type} />
                )}

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {editingNameId === r.id ? (
                      <input
                        data-row-action
                        type="text"
                        autoFocus
                        value={draftName}
                        onChange={(e) => setDraftName(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        onBlur={() => void commitRename(r)}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (e.key === "Enter") void commitRename(r);
                          if (e.key === "Escape") setEditingNameId(null);
                        }}
                        className="flex-1 rounded-md bg-[var(--color-surface-2)] px-2 py-0.5 text-xs outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
                      />
                    ) : (
                      <span className="truncate text-left font-medium">
                        {r.name}
                      </span>
                    )}
                    <span className="shrink-0 text-[10px] text-[var(--color-muted)]">
                      {r.imageCount} images
                    </span>
                  </div>

                  <div className="mt-1.5 flex items-center gap-3 text-[10px] text-[var(--color-muted)]">
                    <span>{new Date(r.createdAt).toLocaleString()}</span>
                    {r.type === "video" && r.duration != null && (
                      <span className="tabular-nums">
                        {formatDuration(r.duration)}
                        {r.width && r.height ? ` · ${r.width}×${r.height}` : ""}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                  {r.type === "video" && (
                    <Link
                      data-row-action
                      href={`/projects/${projectId}/extract/${r.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="rounded-md border border-[var(--color-accent)]/60 bg-[var(--color-accent-soft)] px-2 py-1 text-[11px] font-medium text-[var(--color-accent)] hover:border-[var(--color-accent)]"
                    >
                      Frame Extraction →
                    </Link>
                  )}
                  <RowMenu
                    open={openMenuId === r.id}
                    onToggle={() =>
                      setOpenMenuId((cur) => (cur === r.id ? null : r.id))
                    }
                    onRename={() => startRename(r)}
                    onDelete={() => void onDelete(r)}
                  />
                </div>
              </li>
            );
          })}
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
        </ul>
      )}
    </section>
  );
}

function RowMenu({
  open,
  onToggle,
  onRename,
  onDelete,
}: {
  open: boolean;
  onToggle: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  return (
    <div data-row-action data-row-menu className="relative">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        title="더보기"
        className="rounded-md border border-[var(--color-line)] px-1.5 py-1 text-[11px] hover:border-[var(--color-accent)]"
      >
        ⋯
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 w-32 overflow-hidden rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] shadow-lg">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRename();
            }}
            className="block w-full px-3 py-1.5 text-left text-[11px] hover:bg-[var(--color-surface-2)]"
          >
            이름 변경
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="block w-full px-3 py-1.5 text-left text-[11px] text-[var(--color-danger)] hover:bg-[var(--color-surface-2)]"
          >
            삭제
          </button>
        </div>
      )}
    </div>
  );
}

function FilterChip({
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

function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "—";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function ResourceTypeBadge({ type }: { type: ResourceType }) {
  return (
    <div
      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-[var(--color-surface-2)] text-[10px] text-[var(--color-muted)]"
      title={type}
    >
      {type === "video" ? "VID" : "IMG"}
    </div>
  );
}

function PreviewReel({
  projectId,
  resource,
  extractHref,
}: {
  projectId: string;
  resource: ResourceSummary;
  extractHref: string;
}) {
  const count = resource.previewCount ?? 0;
  const [hover, setHover] = useState(false);
  // Frames 1..N-1 are only mounted after the user actually hovers, so an idle
  // ResourcePool fires one fetch per video instead of N. Once mounted they stay
  // in the DOM so subsequent hovers don't flash.
  const [mountedAll, setMountedAll] = useState(false);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (!hover || count <= 1) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % count), PREVIEW_REEL_INTERVAL_MS);
    return () => clearInterval(t);
  }, [hover, count]);

  useEffect(() => {
    if (!hover) setIdx(0);
  }, [hover]);

  const renderCount = mountedAll ? count : Math.min(1, count);

  return (
    <Link
      data-row-action
      href={extractHref}
      onClick={(e) => e.stopPropagation()}
      title="Frame Extraction 으로 이동"
      className="group relative h-12 w-12 shrink-0 overflow-hidden rounded-md bg-black"
      onMouseEnter={() => {
        setHover(true);
        setMountedAll(true);
      }}
      onMouseLeave={() => setHover(false)}
    >
      {Array.from({ length: renderCount }).map((_, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={i}
          src={resourcePreviewUrl(projectId, resource.id, i)}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          className={[
            "absolute inset-0 h-full w-full object-cover transition-opacity",
            i === idx ? "opacity-100" : "opacity-0",
          ].join(" ")}
        />
      ))}
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-0.5 bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
        <span className="text-base leading-none text-white">▶</span>
        <span className="text-[8px] font-medium uppercase tracking-wider text-white/90">
          Extract
        </span>
      </div>
    </Link>
  );
}
