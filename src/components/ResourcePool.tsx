"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  deleteResource as apiDeleteResource,
  resourcePreviewUrl,
  updateResource,
} from "@/features/resources/service/api";
import type {
  ResourceSummary,
  ResourceType,
} from "@/features/resources/types";
import { TagInput } from "./TagInput";

const PREVIEW_REEL_INTERVAL_MS = 220;

type TypeFilter = "all" | ResourceType;

export type ResourceSelection = {
  resourceId: string | null;
  // Bag of tags from selected resource for parent surfaces; empty when none.
  resourceTags: string[];
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
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [editingTagsId, setEditingTagsId] = useState<string | null>(null);
  const [editingNameId, setEditingNameId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const r of resources) for (const t of r.tags) set.add(t);
    return Array.from(set).sort();
  }, [resources]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return resources.filter((r) => {
      if (typeFilter !== "all" && r.type !== typeFilter) return false;
      if (activeTag && !r.tags.includes(activeTag)) return false;
      if (q) {
        const inName = r.name.toLowerCase().includes(q);
        const inTag = r.tags.some((t) => t.toLowerCase().includes(q));
        if (!inName && !inTag) return false;
      }
      return true;
    });
  }, [resources, search, typeFilter, activeTag]);

  const onDelete = async (r: ResourceSummary) => {
    if (
      !confirm(
        `Resource "${r.name}" 을(를) 삭제하시겠습니까?\n포함된 ${r.imageCount}장의 이미지도 함께 삭제됩니다.`,
      )
    ) {
      return;
    }
    await apiDeleteResource(projectId, r.id);
    if (selection.resourceId === r.id) onSelect({ resourceId: null, resourceTags: [] });
    await reload();
  };

  const startRename = (r: ResourceSummary) => {
    setEditingNameId(r.id);
    setDraftName(r.name);
  };

  const commitRename = async (r: ResourceSummary) => {
    const next = draftName.trim();
    setEditingNameId(null);
    if (!next || next === r.name) return;
    await updateResource(projectId, r.id, { name: next });
    await reload();
  };

  const commitTags = async (r: ResourceSummary, tags: string[]) => {
    await updateResource(projectId, r.id, { tags });
    await reload();
  };

  return (
    <section className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)]">
      <header className="border-b border-[var(--color-line)] px-3 py-2">
        <h2 className="text-xs font-semibold tracking-tight">Resource Pool</h2>
        <p className="mt-0.5 text-[11px] text-[var(--color-muted)]">
          업로드 묶음 단위로 자료를 관리합니다.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-line)] px-3 py-2 text-xs">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="이름 / 태그 검색"
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

      {allTags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 border-b border-[var(--color-line)] px-3 py-1.5 text-[11px]">
          <span className="mr-1 text-[var(--color-muted)]">tags:</span>
          <FilterChip active={activeTag === null} onClick={() => setActiveTag(null)}>
            전체
          </FilterChip>
          {allTags.map((t) => (
            <FilterChip
              key={t}
              active={activeTag === t}
              onClick={() => setActiveTag(activeTag === t ? null : t)}
            >
              {t}
            </FilterChip>
          ))}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="px-3 py-6 text-center text-xs text-[var(--color-muted)]">
          {resources.length === 0
            ? "Resource 가 없습니다. 상단에서 업로드하세요."
            : "조건에 맞는 Resource 가 없습니다."}
        </div>
      ) : (
        <ul className="divide-y divide-[var(--color-line)]">
          {filtered.map((r) => {
            const selected = selection.resourceId === r.id;
            return (
              <li
                key={r.id}
                className={[
                  "px-3 py-2 text-xs transition",
                  selected ? "bg-[var(--color-accent-soft)]" : "hover:bg-[var(--color-surface-2)]",
                ].join(" ")}
              >
                <div className="flex items-start gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      onSelect(
                        selected
                          ? { resourceId: null, resourceTags: [] }
                          : { resourceId: r.id, resourceTags: r.tags },
                      )
                    }
                    aria-pressed={selected}
                    className={[
                      "mt-0.5 h-3.5 w-3.5 shrink-0 rounded border transition",
                      selected
                        ? "border-[var(--color-accent)] bg-[var(--color-accent)]"
                        : "border-[var(--color-line)] hover:border-[var(--color-accent)]",
                    ].join(" ")}
                  />

                  {r.type === "video" && (r.previewCount ?? 0) > 0 ? (
                    <PreviewReel projectId={projectId} resource={r} />
                  ) : (
                    <ResourceTypeBadge type={r.type} />
                  )}

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {editingNameId === r.id ? (
                        <input
                          type="text"
                          autoFocus
                          value={draftName}
                          onChange={(e) => setDraftName(e.target.value)}
                          onBlur={() => void commitRename(r)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void commitRename(r);
                            if (e.key === "Escape") setEditingNameId(null);
                          }}
                          className="flex-1 rounded-md bg-[var(--color-surface-2)] px-2 py-0.5 text-xs outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => startRename(r)}
                          title="이름 변경"
                          className="truncate text-left font-medium hover:text-[var(--color-accent)]"
                        >
                          {r.name}
                        </button>
                      )}
                      <span className="shrink-0 text-[10px] text-[var(--color-muted)]">
                        {r.imageCount} images
                      </span>
                    </div>

                    <div className="mt-1">
                      {editingTagsId === r.id ? (
                        <TagInput
                          value={r.tags}
                          onChange={(next) => void commitTags(r, next)}
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => setEditingTagsId(r.id)}
                          className="flex flex-wrap items-center gap-1 text-left"
                          title="태그 편집"
                        >
                          {r.tags.length === 0 ? (
                            <span className="text-[10px] text-[var(--color-muted)]">
                              + 태그 추가
                            </span>
                          ) : (
                            r.tags.map((t) => (
                              <span
                                key={t}
                                className="rounded-full bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[10px]"
                              >
                                {t}
                              </span>
                            ))
                          )}
                        </button>
                      )}
                    </div>

                    <div className="mt-1.5 flex items-center gap-3 text-[10px] text-[var(--color-muted)]">
                      <span>{new Date(r.createdAt).toLocaleString()}</span>
                      {r.type === "video" && (
                        <Link
                          href={`/projects/${projectId}/extract/${r.id}`}
                          className="hover:text-[var(--color-accent)]"
                        >
                          Frame Extraction →
                        </Link>
                      )}
                      {editingTagsId === r.id && (
                        <button
                          type="button"
                          onClick={() => setEditingTagsId(null)}
                          className="hover:text-[var(--color-accent)]"
                        >
                          편집 종료
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void onDelete(r)}
                        className="ml-auto hover:text-[var(--color-danger)]"
                      >
                        삭제
                      </button>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
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
}: {
  projectId: string;
  resource: ResourceSummary;
}) {
  const count = resource.previewCount ?? 0;
  const [hover, setHover] = useState(false);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (!hover || count <= 1) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % count), PREVIEW_REEL_INTERVAL_MS);
    return () => clearInterval(t);
  }, [hover, count]);

  useEffect(() => {
    if (!hover) setIdx(0);
  }, [hover]);

  return (
    <div
      className="relative h-12 w-12 shrink-0 overflow-hidden rounded-md bg-black"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {Array.from({ length: count }).map((_, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={i}
          src={resourcePreviewUrl(projectId, resource.id, i)}
          alt=""
          className={[
            "absolute inset-0 h-full w-full object-cover transition-opacity",
            i === idx ? "opacity-100" : "opacity-0",
          ].join(" ")}
        />
      ))}
    </div>
  );
}
