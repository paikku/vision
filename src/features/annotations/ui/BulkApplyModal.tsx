"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Frame } from "@/features/frames/types";
import { selectVisibleFrames, useStore } from "@/lib/store";
import {
  Badge,
  Button,
  Menu,
  MenuItem,
  MenuSeparator,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  SegmentedControl,
  cn,
} from "@/shared/ui";
import type { Annotation, LabelClass } from "../types";

type ContextMenu = { frameId: string; x: number; y: number };

interface Props {
  annotation: Annotation;
  frames: Frame[];
  annotations: Annotation[];
  exceptedFrameIds: Record<string, boolean>;
  classes: LabelClass[];
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
  const sort = useStore((s) => s.frameSortOrder);
  const filter = useStore((s) => s.frameFilterMode);
  const setSort = useStore((s) => s.setFrameSortOrder);
  const setFilter = useStore((s) => s.setFrameFilterMode);
  const activeFrameId = useStore((s) => s.activeFrameId);

  const [selected, setSelected] = useState<Set<string>>(() => new Set(frames.map((f) => f.id)));
  const [ctxMenu, setCtxMenu] = useState<ContextMenu | null>(null);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const a of annotations) {
      map.set(a.frameId, (map.get(a.frameId) ?? 0) + 1);
    }
    return map;
  }, [annotations]);

  const classCounts = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    for (const a of annotations) {
      let inner = map.get(a.frameId);
      if (!inner) {
        inner = new Map();
        map.set(a.frameId, inner);
      }
      inner.set(a.classId, (inner.get(a.classId) ?? 0) + 1);
    }
    return map;
  }, [annotations]);

  const classById = useMemo(() => {
    const map = new Map<string, LabelClass>();
    for (const c of classes) map.set(c.id, c);
    return map;
  }, [classes]);

  const displayFrames = useMemo(
    () =>
      selectVisibleFrames({
        frames,
        annotations,
        exceptedFrameIds,
        frameSortOrder: sort,
        frameFilterMode: filter,
      }),
    [frames, annotations, exceptedFrameIds, sort, filter],
  );

  const gridRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!activeFrameId) return;
    const el = gridRef.current?.querySelector<HTMLElement>(
      `[data-frame-id="${activeFrameId}"]`,
    );
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeFrameId]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
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
    <Modal open size="xl" onClose={onClose} aria-label="일괄 적용">
      <ModalHeader
        onClose={onClose}
        title={
          <span className="flex items-center gap-2">
            <span
              className="h-3 w-3 rounded-[var(--radius-xs)]"
              style={{ background: klass?.color ?? "#888" }}
            />
            일괄 적용 — {klass?.name ?? "—"}
          </span>
        }
        subtitle={`${selected.size}개 선택 / ${displayFrames.length}개 표시`}
      />

      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-[var(--color-line)] px-5 py-2">
        <div className="flex items-center gap-2">
          <span className="text-[var(--text-2xs)] uppercase tracking-wide text-[var(--color-muted)]">정렬</span>
          <SegmentedControl
            size="sm"
            value={sort}
            onChange={(v) => setSort(v)}
            options={[
              { value: "added", label: "추가순" },
              { value: "time", label: "시간순" },
            ]}
            aria-label="정렬 순서"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[var(--text-2xs)] uppercase tracking-wide text-[var(--color-muted)]">필터</span>
          <SegmentedControl
            size="sm"
            value={filter}
            onChange={(v) => setFilter(v)}
            options={[
              { value: "all", label: "전체" },
              { value: "unlabeled", label: "미라벨" },
            ]}
            aria-label="프레임 필터"
          />
        </div>
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="xs"
            onClick={() => setSelected(new Set(displayFrames.map((f) => f.id)))}
          >
            전체 선택
          </Button>
          <Button variant="ghost" size="xs" onClick={() => setSelected(new Set())}>
            전체 해제
          </Button>
        </div>
      </div>

      <ModalBody ref={gridRef}>
        {displayFrames.length === 0 ? (
          <p className="py-8 text-center text-[var(--text-sm)] text-[var(--color-muted)]">
            표시할 프레임 없음
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-3 lg:grid-cols-4 xl:grid-cols-5">
            {displayFrames.map((f) => {
              const isSelected = selected.has(f.id);
              const isActive = f.id === activeFrameId;
              const originalIdx = frames.indexOf(f);
              const count = counts.get(f.id) ?? 0;
              const excepted = !!exceptedFrameIds[f.id];
              const frameClassCounts = classCounts.get(f.id);
              return (
                <div
                  key={f.id}
                  data-frame-id={f.id}
                  style={
                    isActive
                      ? { outline: "2px solid var(--color-warning)", outlineOffset: "2px" }
                      : undefined
                  }
                  className={cn(
                    "group relative cursor-pointer select-none overflow-hidden rounded-[var(--radius-md)] border-2 transition-all",
                    isSelected
                      ? "border-[var(--color-accent)] ring-2 ring-[var(--color-accent)]/30"
                      : "border-[var(--color-line)] opacity-60 hover:opacity-100",
                  )}
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
                  <div className="absolute left-1 top-1">
                    <div
                      className={cn(
                        "flex h-4 w-4 items-center justify-center rounded-[var(--radius-xs)] border-2 text-[var(--text-2xs)] font-bold",
                        isSelected
                          ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-white"
                          : "border-white/60 bg-black/30",
                      )}
                    >
                      {isSelected && "✓"}
                    </div>
                  </div>
                  {isActive && (
                    <Badge
                      tone="warning"
                      size="xs"
                      shape="pill"
                      className="absolute right-1 top-1 shadow-[var(--shadow-xs)]"
                    >
                      현재
                    </Badge>
                  )}
                  <div className="flex items-center justify-between bg-[var(--color-surface)] px-2 py-1 text-[var(--text-2xs)] text-[var(--color-muted)]">
                    <span className="truncate tabular-nums">
                      #{String(originalIdx + 1).padStart(2, "0")} · {f.label}
                    </span>
                    <Badge tone="neutral" size="xs" shape="pill" className="ml-1 shrink-0">
                      {count}
                    </Badge>
                  </div>
                  <div className="flex min-h-[18px] flex-wrap gap-1 bg-[var(--color-surface)] px-2 pb-1">
                    {count === 0
                      ? excepted && (
                          <Badge tone="accent" size="xs" shape="pill">
                            제외됨
                          </Badge>
                        )
                      : frameClassCounts &&
                        [...frameClassCounts.entries()].map(([cid, n]) => {
                          const cls = classById.get(cid);
                          if (!cls) return null;
                          return (
                            <Badge
                              key={cid}
                              size="xs"
                              shape="pill"
                              color={cls.color}
                              title={cls.name}
                              swatch={<span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-70" />}
                            >
                              {n}
                            </Badge>
                          );
                        })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </ModalBody>

      <ModalFooter className="justify-between">
        <p className="text-[var(--text-xs)] text-[var(--color-muted)]">
          우클릭: 기준 프레임 직전·직후 선택/해제
        </p>
        <div className="flex gap-2">
          <Button variant="secondary" size="md" onClick={onClose}>
            취소
          </Button>
          <Button
            variant="primary"
            size="md"
            disabled={selected.size === 0}
            onClick={() => {
              onApply([...selected]);
              onClose();
            }}
          >
            {selected.size}개 프레임에 적용
          </Button>
        </div>
      </ModalFooter>

      {ctxMenu && (
        <Menu open onClose={() => setCtxMenu(null)} x={ctxMenu.x} y={ctxMenu.y}>
          <MenuItem onClick={() => selectRelative(ctxMenu.frameId, "before", true)}>
            이전 모두 선택
          </MenuItem>
          <MenuItem onClick={() => selectRelative(ctxMenu.frameId, "before", false)}>
            이전 모두 해제
          </MenuItem>
          <MenuSeparator />
          <MenuItem onClick={() => selectRelative(ctxMenu.frameId, "after", true)}>
            이후 모두 선택
          </MenuItem>
          <MenuItem onClick={() => selectRelative(ctxMenu.frameId, "after", false)}>
            이후 모두 해제
          </MenuItem>
        </Menu>
      )}
    </Modal>
  );
}
