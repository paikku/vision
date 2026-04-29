"use client";

import { useEffect, useMemo, useState } from "react";
import { TASK_TYPES, type TaskType } from "@/features/annotations/types";
import type { ImageMeta, ResourceSummary } from "@/features/projects";
import {
  createLabelSet,
  imageUrl,
} from "@/features/projects/service/api";

type Props = {
  projectId: string;
  resources: ResourceSummary[];
  images: ImageMeta[];
  onClose: () => void;
  onCreated: (labelsetId: string) => void;
};

export function CreateLabelSetModal({
  projectId,
  resources,
  images,
  onClose,
  onCreated,
}: Props) {
  const [name, setName] = useState("");
  const [taskType, setTaskType] = useState<TaskType>("bbox");
  const [resourceFilter, setResourceFilter] = useState<string | "all">("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return images.filter((im) => {
      if (resourceFilter !== "all" && im.resourceId !== resourceFilter) return false;
      if (q && !im.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [images, resourceFilter, search]);

  const resourceById = useMemo(() => {
    const m = new Map<string, ResourceSummary>();
    for (const r of resources) m.set(r.id, r);
    return m;
  }, [resources]);

  const allFilteredSelected =
    filtered.length > 0 && filtered.every((im) => selected.has(im.id));

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAllFiltered = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        for (const im of filtered) next.delete(im.id);
      } else {
        for (const im of filtered) next.add(im.id);
      }
      return next;
    });
  };

  const submit = async () => {
    setError(null);
    if (busy) return;
    if (!name.trim()) {
      setError("라벨셋 이름을 입력하세요.");
      return;
    }
    if (selected.size === 0) {
      setError("최소 1장의 이미지를 선택하세요.");
      return;
    }
    setBusy(true);
    try {
      const ls = await createLabelSet(projectId, {
        name: name.trim(),
        taskType,
        imageIds: [...selected],
      });
      onCreated(ls.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "생성 실패");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="absolute inset-0" onClick={onClose} />
      <div className="relative z-10 flex h-[90vh] w-[1100px] max-w-[95vw] flex-col overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-bg)] shadow-2xl">
        <header className="flex items-center justify-between border-b border-[var(--color-line)] px-4 py-3">
          <div className="text-sm font-semibold">라벨셋 생성</div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md border border-[var(--color-line)] px-2 py-1 text-xs text-[var(--color-muted)] hover:text-[var(--color-text)] disabled:opacity-40"
          >
            닫기 (Esc)
          </button>
        </header>

        <div className="grid shrink-0 grid-cols-[1fr_1fr] gap-4 border-b border-[var(--color-line)] p-4">
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-[var(--color-muted)]">라벨셋 이름</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: scratch_v1_bbox"
              disabled={busy}
              className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
            />
          </label>
          <div className="flex flex-col gap-1 text-xs">
            <span className="text-[var(--color-muted)]">라벨링 타입</span>
            <div className="flex gap-2">
              {TASK_TYPES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  disabled={busy}
                  onClick={() => setTaskType(t.id)}
                  title={t.description}
                  className={[
                    "flex-1 rounded-md border px-2 py-2 text-xs font-medium transition",
                    taskType === t.id
                      ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                      : "border-[var(--color-line)] hover:border-[var(--color-accent)]",
                  ].join(" ")}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-[var(--color-line)] px-4 py-2">
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
          <button
            type="button"
            onClick={toggleAllFiltered}
            className="rounded border border-[var(--color-line)] px-2 py-1 text-xs hover:border-[var(--color-accent)]"
          >
            {allFilteredSelected ? "보이는 항목 해제" : "보이는 항목 모두 선택"}
          </button>
          <span className="ml-auto text-xs text-[var(--color-muted)]">
            선택: {selected.size} / 표시: {filtered.length}
          </span>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {filtered.length === 0 ? (
            <p className="py-12 text-center text-sm text-[var(--color-muted)]">
              {images.length === 0
                ? "프로젝트에 이미지가 없습니다. 먼저 동영상을 업로드해 프레임을 추출하거나 이미지 묶음을 업로드하세요."
                : "조건에 맞는 이미지가 없습니다."}
            </p>
          ) : (
            <ul
              role="list"
              className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2"
            >
              {filtered.map((im) => {
                const isSelected = selected.has(im.id);
                const resource = resourceById.get(im.resourceId);
                return (
                  <li
                    key={im.id}
                    onClick={() => toggle(im.id)}
                    className={[
                      "group relative cursor-pointer overflow-hidden rounded-md border-2 transition",
                      isSelected
                        ? "border-[var(--color-accent)] ring-2 ring-[var(--color-accent)]/30"
                        : "border-[var(--color-line)] opacity-80 hover:opacity-100",
                    ].join(" ")}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={imageUrl(projectId, im.id)}
                      alt={im.name}
                      loading="lazy"
                      decoding="async"
                      className="aspect-video w-full bg-black object-contain"
                    />
                    <div className="absolute left-1 top-1">
                      <div
                        className={[
                          "h-4 w-4 rounded border-2 flex items-center justify-center text-[10px] font-bold",
                          isSelected
                            ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-white"
                            : "border-white/60 bg-black/30",
                        ].join(" ")}
                      >
                        {isSelected && "✓"}
                      </div>
                    </div>
                    <div className="bg-[var(--color-surface)] px-2 py-1 text-[11px]">
                      <div className="truncate">{im.name}</div>
                      <div className="truncate text-[10px] text-[var(--color-muted)]">
                        {resource?.name ?? "—"}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-[var(--color-line)] px-4 py-3">
          {error ? (
            <span className="text-xs text-[var(--color-danger)]">{error}</span>
          ) : (
            <span className="text-xs text-[var(--color-muted)]">
              {busy ? "생성 중…" : "이미지를 선택한 뒤 라벨셋을 생성하세요."}
            </span>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded-md border border-[var(--color-line)] px-3 py-1.5 text-xs text-[var(--color-muted)] hover:text-[var(--color-text)] disabled:opacity-40"
            >
              취소
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void submit()}
              className="rounded-md bg-[var(--color-accent)] px-4 py-1.5 text-xs font-medium text-black disabled:opacity-40"
            >
              라벨셋 생성
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
