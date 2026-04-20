"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Annotation, Frame, LabelClass } from "@/lib/types";

type SortOrder = "added" | "time";
type FilterMode = "all" | "unlabeled";

type ContextMenu = { frameId: string; x: number; y: number };

interface Props {
  annotation: Annotation;
  frames: Frame[];
  annotations: Annotation[];
  exceptedFrameIds: Record<string, boolean>;
  classes: LabelClass[];
  /** Called with the list of frame IDs to apply to (annotation is copied). */
  onApply: (frameIds: string[]) => void;
  onClose: () => void;
}

export function BulkApplyModal({
  annotation,
  frames,
  annotations,
  exceptedFrameIds,
  classes,
  onApply,
  onClose,
}: Props) {
  const [sort, setSort] = useState<SortOrder>("added");
  const [filter, setFilter] = useState<FilterMode>("all");
  const [selected, setSelected] = useState<Set<string>>(() => new Set(frames.map((f) => f.id)));
  const [ctxMenu, setCtxMenu] = useState<ContextMenu | null>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  // Close context menu on outside click
  useEffect(() => {
    if (!ctxMenu) return;
    const handler = () => setCtxMenu(null);
    window.addEventListener("pointerdown", handler);
    return () => window.removeEventListener("pointerdown", handler);
  }, [ctxMenu]);

  // Close modal on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const a of annotations) {
      map.set(a.frameId, (map.get(a.frameId) ?? 0) + 1);
    }
    return map;
  }, [annotations]);

  const sortedFrames = useMemo(() => {
    const list = [...frames];
    if (sort === "time") list.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
    return list;
  }, [frames, sort]);

  const displayFrames = useMemo(() => {
    if (filter === "all") return sortedFrames;
    return sortedFrames.filter(
      (f) => (counts.get(f.id) ?? 0) === 0 && !exceptedFrameIds[f.id],
    );
  }, [sortedFrames, filter, counts, exceptedFrameIds]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const selectRelative = (refId: string, dir: "before" | "after", select: boolean) => {
    const refIdx = displayFrames.findIndex((f) => f.id === refId);
    if (refIdx === -1) return;
    const targets =
      dir === "before"
        ? displayFrames.slice(0, refIdx).map((f) => f.id)
        : displayFrames.slice(refIdx + 1).map((f) => f.id);
    setSelected((prev) => {
      const next = new Set(prev);
      targets.forEach((id) => (select ? next.add(id) : next.delete(id)));
      return next;
    });
    setCtxMenu(null);
  };

  const klass = classes.find((c) => c.id === annotation.classId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div
        ref={backdropRef}
        className="absolute inset-0"
        onClick={onClose}
      />
      <div
        className="relative z-10 flex max-h-[90vh] w-[860px] max-w-[95vw] flex-col overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--color-line)] px-4 py-3">
          <div className="flex items-center gap-2">
            <span
              className="h-3 w-3 rounded-sm"
              style={{ background: klass?.color ?? "#888" }}
            />
            <span className="text-sm font-semibold">
              일괄 적용 — {klass?.name ?? "—"}
            </span>
            <span className="text-xs text-[var(--color-muted)]">
              {selected.size}개 선택 / {displayFrames.length}개 표시
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[var(--color-muted)] hover:text-[var(--color-text)]"
          >
            ✕
          </button>
        </div>

        {/* Controls */}
        <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-[var(--color-line)] px-4 py-2">
          <div className="flex items-center gap-1">
            <span className="text-[11px] text-[var(--color-muted)]">정렬</span>
            {(["added", "time"] as SortOrder[]).map((s) => (
              <button key={s} type="button" onClick={() => setSort(s)}
                className={["rounded px-2 py-0.5 text-[11px] transition", sort === s ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)]" : "text-[var(--color-muted)] hover:text-[var(--color-text)]"].join(" ")}>
                {s === "added" ? "추가순" : "시간순"}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[11px] text-[var(--color-muted)]">필터</span>
            {(["all", "unlabeled"] as FilterMode[]).map((f) => (
              <button key={f} type="button" onClick={() => setFilter(f)}
                className={["rounded px-2 py-0.5 text-[11px] transition", filter === f ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)]" : "text-[var(--color-muted)] hover:text-[var(--color-text)]"].join(" ")}>
                {f === "all" ? "전체" : "미라벨"}
              </button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button type="button" onClick={() => setSelected(new Set(displayFrames.map((f) => f.id)))}
              className="text-[11px] text-[var(--color-muted)] hover:text-[var(--color-text)]">
              전체 선택
            </button>
            <button type="button" onClick={() => setSelected(new Set())}
              className="text-[11px] text-[var(--color-muted)] hover:text-[var(--color-text)]">
              전체 해제
            </button>
          </div>
        </div>

        {/* Thumbnail grid */}
        <div className="flex-1 overflow-y-auto p-4">
          {displayFrames.length === 0 ? (
            <p className="py-8 text-center text-sm text-[var(--color-muted)]">표시할 프레임 없음</p>
          ) : (
            <div className="grid grid-cols-4 gap-3 xl:grid-cols-5">
              {displayFrames.map((f, idx) => {
                const isSelected = selected.has(f.id);
                const originalIdx = frames.indexOf(f);
                return (
                  <div
                    key={f.id}
                    className={[
                      "group relative cursor-pointer select-none overflow-hidden rounded-lg border-2 transition",
                      isSelected
                        ? "border-[var(--color-accent)] ring-2 ring-[var(--color-accent)]/30"
                        : "border-[var(--color-line)] opacity-50",
                    ].join(" ")}
                    onClick={() => toggle(f.id)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setCtxMenu({ frameId: f.id, x: e.clientX, y: e.clientY });
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={f.url}
                      alt={f.label}
                      className="aspect-video w-full bg-black object-contain"
                    />
                    {/* Checkbox overlay */}
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
                    {/* Frame label */}
                    <div className="bg-[var(--color-surface)] px-1.5 py-0.5 text-[10px] text-[var(--color-muted)] truncate">
                      #{String(originalIdx + 1).padStart(2, "0")} · {f.label}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-between border-t border-[var(--color-line)] px-4 py-3">
          <p className="text-xs text-[var(--color-muted)]">
            우클릭: 기준 프레임 직전·직후 선택/해제
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={onClose}
              className="rounded border border-[var(--color-line)] px-3 py-1.5 text-sm hover:border-[var(--color-muted)]">
              취소
            </button>
            <button
              type="button"
              disabled={selected.size === 0}
              onClick={() => { onApply([...selected]); onClose(); }}
              className="rounded bg-[var(--color-accent)] px-4 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40"
            >
              {selected.size}개 프레임에 적용
            </button>
          </div>
        </div>
      </div>

      {/* Right-click context menu for before/after select */}
      {ctxMenu && (
        <div
          className="fixed z-50 overflow-hidden rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] py-1 shadow-xl text-sm"
          style={{ top: ctxMenu.y, left: ctxMenu.x }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {[
            { label: "이전 모두 선택", dir: "before" as const, select: true },
            { label: "이전 모두 해제", dir: "before" as const, select: false },
            { label: "이후 모두 선택", dir: "after" as const, select: true },
            { label: "이후 모두 해제", dir: "after" as const, select: false },
          ].map(({ label, dir, select }) => (
            <button
              key={label}
              type="button"
              onClick={() => selectRelative(ctxMenu.frameId, dir, select)}
              className="block w-full px-4 py-1.5 text-left text-xs hover:bg-[var(--color-surface-2)]"
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
