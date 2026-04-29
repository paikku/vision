"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { isEditableElement } from "@/shared/dom/isEditableElement";
import {
  fetchSegmentModels,
  isSegmentModelId,
  segmentRegion,
  SEGMENT_REQUEST_MIN_INTERVAL_MS,
  toShape,
} from "../service/segment";
import { shapeAabb } from "../shape-utils";
import { BulkApplyModal } from "./BulkApplyModal";
import type { ClassShortcutKey } from "../types";

const CLASS_SHORTCUT_KEYS: ClassShortcutKey[] = ["q", "w", "e", "r"];
const REMOVE_KEYS = new Set(["d"]);
const SEGMENT_KEY = "h";

export function LabelPanel() {
  const taskType = useStore((s) => s.taskType);
  const classes = useStore((s) => s.classes);
  const activeClassId = useStore((s) => s.activeClassId);
  const setActiveClass = useStore((s) => s.setActiveClass);
  const addClass = useStore((s) => s.addClass);
  const removeClass = useStore((s) => s.removeClass);
  const renameClass = useStore((s) => s.renameClass);
  const setClassShortcut = useStore((s) => s.setClassShortcut);
  const setClassColor = useStore((s) => s.setClassColor);

  const annotations = useStore((s) => s.annotations);
  const classifications = useStore((s) => s.classifications);
  const frames = useStore((s) => s.frames);
  const activeFrameId = useStore((s) => s.activeFrameId);
  const selectedAnnotationId = useStore((s) => s.selectedAnnotationId);
  const selectAnnotation = useStore((s) => s.selectAnnotation);
  const removeAnnotation = useStore((s) => s.removeAnnotation);
  const updateAnnotation = useStore((s) => s.updateAnnotation);
  const setHoveredAnnotation = useStore((s) => s.setHoveredAnnotation);
  const addAnnotation = useStore((s) => s.addAnnotation);
  const exceptedFrameIds = useStore((s) => s.exceptedFrameIds);
  const segmentModel = useStore((s) => s.segmentModel);
  const setSegmentModel = useStore((s) => s.setSegmentModel);
  const segmentModels = useStore((s) => s.segmentModels);
  const setSegmentModels = useStore((s) => s.setSegmentModels);
  const segmentingIds = useStore((s) => s.segmentingIds);
  const setSegmenting = useStore((s) => s.setSegmenting);
  const markSegmentRequested = useStore((s) => s.markSegmentRequested);
  const toggleClassification = useStore((s) => s.toggleClassification);

  const isClassify = taskType === "classify";

  const [draftName, setDraftName] = useState("");
  const [hoveredClassId, setHoveredClassId] = useState<string | null>(null);
  const hoveredClassIdRef = useRef(hoveredClassId);
  hoveredClassIdRef.current = hoveredClassId;

  const hoveredAnnotationId = useStore((s) => s.hoveredAnnotationId);
  const setHoveredAnnotationLocal = useCallback((id: string | null) => {
    setHoveredAnnotation(id);
  }, [setHoveredAnnotation]);

  const [bulkAnnotationId, setBulkAnnotationId] = useState<string | null>(null);
  const [annotCtxMenu, setAnnotCtxMenu] = useState<{ id: string; x: number; y: number } | null>(null);

  const segmentCtlRef = useRef<Map<string, AbortController>>(new Map());
  useEffect(() => {
    const controllers = segmentCtlRef.current;
    return () => {
      for (const ctl of controllers.values()) ctl.abort();
      controllers.clear();
    };
  }, []);

  useEffect(() => {
    if (!annotCtxMenu) return;
    const handler = () => setAnnotCtxMenu(null);
    window.addEventListener("pointerdown", handler);
    return () => window.removeEventListener("pointerdown", handler);
  }, [annotCtxMenu]);

  useEffect(() => {
    const ctl = new AbortController();
    void (async () => {
      const list = await fetchSegmentModels({ signal: ctl.signal });
      if (ctl.signal.aborted || !list) return;
      setSegmentModels(list.models);
      const current = useStore.getState().segmentModel;
      if (!list.models.some((m) => m.id === current)) {
        setSegmentModel(list.defaultId);
      }
    })();
    return () => ctl.abort();
  }, [setSegmentModel, setSegmentModels]);

  const frameAnnotations = annotations.filter(
    (a) => a.imageId === activeFrameId,
  );
  const frameClassificationClassIds = useMemo(() => {
    if (!activeFrameId) return new Set<string>();
    return new Set(
      classifications
        .filter((c) => c.imageId === activeFrameId)
        .map((c) => c.classId),
    );
  }, [activeFrameId, classifications]);

  const runSegment = useCallback(
    async (annotationId: string) => {
      const state = useStore.getState();
      const ann = state.annotations.find((a) => a.id === annotationId);
      if (!ann) return;
      const frame = state.frames.find((f) => f.id === ann.imageId);
      if (!frame) return;
      const klass = state.classes.find((c) => c.id === ann.classId);

      const now = Date.now();
      const last = state.lastSegmentRequestAt[annotationId] ?? 0;
      if (now - last < SEGMENT_REQUEST_MIN_INTERVAL_MS) return;
      markSegmentRequested(annotationId, now);

      const prev = segmentCtlRef.current.get(annotationId);
      if (prev) prev.abort();
      const ctl = new AbortController();
      segmentCtlRef.current.set(annotationId, ctl);
      setSegmenting(annotationId, true);

      try {
        const result = await segmentRegion(
          frame.url,
          {
            bbox: shapeAabb(ann.shape),
            classHint: klass?.name,
            model: useStore.getState().segmentModel,
          },
          { signal: ctl.signal },
        );
        if (ctl.signal.aborted) return;
        if (!result) return;
        const stillExists = useStore
          .getState()
          .annotations.some((a) => a.id === annotationId);
        if (!stillExists) return;
        updateAnnotation(annotationId, { shape: toShape(result) });
      } finally {
        if (segmentCtlRef.current.get(annotationId) === ctl) {
          segmentCtlRef.current.delete(annotationId);
        }
        setSegmenting(annotationId, false);
      }
    },
    [markSegmentRequested, setSegmenting, updateAnnotation],
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isEditableElement(e.target)) return;
      const key = e.key.toLowerCase();

      // Priority 1: hover-class + Q/W/E/R → assign shortcut + activate class
      if (CLASS_SHORTCUT_KEYS.includes(key as ClassShortcutKey)) {
        const hoveredClass = hoveredClassIdRef.current;
        if (hoveredClass) {
          e.preventDefault();
          e.stopImmediatePropagation();
          setClassShortcut(hoveredClass, key as ClassShortcutKey);
          setActiveClass(hoveredClass);
          return;
        }
      }

      // Classify mode: Q/W/E/R toggles the active image's classification
      if (
        isClassify &&
        CLASS_SHORTCUT_KEYS.includes(key as ClassShortcutKey)
      ) {
        const klass = useStore
          .getState()
          .classes.find((c) => c.shortcutKey === key);
        const imageId = useStore.getState().activeFrameId;
        if (klass && imageId) {
          e.preventDefault();
          e.stopImmediatePropagation();
          toggleClassification(imageId, klass.id);
          return;
        }
      }

      // Shape modes: hovered annotation operations
      const hoveredAnnotation = useStore.getState().hoveredAnnotationId;
      if (!isClassify && hoveredAnnotation) {
        if (REMOVE_KEYS.has(key)) {
          e.preventDefault();
          e.stopImmediatePropagation();
          removeAnnotation(hoveredAnnotation);
          setHoveredAnnotationLocal(null);
          return;
        }
        if (CLASS_SHORTCUT_KEYS.includes(key as ClassShortcutKey)) {
          const klass = useStore
            .getState()
            .classes.find((c) => c.shortcutKey === key);
          if (klass) {
            e.preventDefault();
            e.stopImmediatePropagation();
            updateAnnotation(hoveredAnnotation, { classId: klass.id });
            return;
          }
        }
        if (key === SEGMENT_KEY) {
          e.preventDefault();
          e.stopImmediatePropagation();
          void runSegment(hoveredAnnotation);
          return;
        }
      }
    };
    window.addEventListener("keydown", handler, { capture: true });
    return () => window.removeEventListener("keydown", handler, { capture: true });
  }, [
    isClassify,
    removeAnnotation,
    runSegment,
    setActiveClass,
    setClassShortcut,
    setHoveredAnnotationLocal,
    toggleClassification,
    updateAnnotation,
  ]);

  return (
    <>
    <div className="flex h-full w-72 flex-col border-l border-[var(--color-line)] bg-[var(--color-surface)] text-sm">
      <Section title="Classes">
        <p className="mb-2 text-[10px] text-[var(--color-muted)]">
          {isClassify
            ? "체크박스로 현재 이미지에 클래스를 부여 · Q/W/E/R 단축키 토글"
            : "Hover a class, press Q/W/E/R to assign shortcut."}
        </p>
        <ul className="space-y-1">
          {classes.map((c) => {
            const active = c.id === activeClassId;
            const isHovered = c.id === hoveredClassId;
            const classifiedHere = frameClassificationClassIds.has(c.id);
            return (
              <li
                key={c.id}
                onMouseEnter={() => setHoveredClassId(c.id)}
                onMouseLeave={() => setHoveredClassId(null)}
                className={[
                  "group flex items-center gap-2 rounded px-2 py-1.5 transition",
                  active
                    ? "bg-[var(--color-accent-soft)]"
                    : isHovered
                      ? "bg-[var(--color-surface-2)] ring-1 ring-[var(--color-accent)]/40"
                      : "hover:bg-[var(--color-surface-2)]",
                ].join(" ")}
              >
                {isClassify && (
                  <input
                    type="checkbox"
                    checked={classifiedHere}
                    disabled={!activeFrameId}
                    onChange={(e) => {
                      e.stopPropagation();
                      if (!activeFrameId) return;
                      toggleClassification(activeFrameId, c.id);
                    }}
                    className="h-3.5 w-3.5 shrink-0 accent-[var(--color-accent)]"
                  />
                )}
                <button
                  type="button"
                  onClick={() => setActiveClass(c.id)}
                  className="flex flex-1 items-center gap-2 text-left"
                >
                  <label
                    title="Click to change color"
                    className="h-3.5 w-3.5 shrink-0 cursor-pointer rounded-sm ring-offset-1 hover:ring-2 hover:ring-[var(--color-accent)]"
                    style={{ background: c.color }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="color"
                      value={c.color}
                      onChange={(e) => setClassColor(c.id, e.target.value)}
                      className="sr-only"
                    />
                  </label>
                  <input
                    value={c.name}
                    onChange={(e) => renameClass(c.id, e.target.value)}
                    className="flex-1 bg-transparent outline-none"
                  />
                </button>

                <div className="shrink-0">
                  {c.shortcutKey ? (
                    <button
                      type="button"
                      title="Click to clear shortcut"
                      onClick={() => setClassShortcut(c.id, null)}
                      className="flex h-5 w-5 items-center justify-center rounded border border-[var(--color-accent)]/60 bg-[var(--color-accent-soft)] font-mono text-[10px] text-[var(--color-accent)] hover:border-[var(--color-danger)] hover:text-[var(--color-danger)]"
                    >
                      {c.shortcutKey.toUpperCase()}
                    </button>
                  ) : isHovered ? (
                    <span className="flex h-5 w-5 items-center justify-center rounded border border-dashed border-[var(--color-line)] font-mono text-[10px] text-[var(--color-muted)]">
                      ?
                    </span>
                  ) : null}
                </div>

                <button
                  type="button"
                  onClick={() => removeClass(c.id)}
                  className="invisible text-xs text-[var(--color-muted)] hover:text-[var(--color-danger)] group-hover:visible"
                  title="Remove class"
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
        <form
          className="mt-2 flex gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            addClass(draftName);
            setDraftName("");
          }}
        >
          <input
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            placeholder="new class name"
            className="flex-1 rounded border border-[var(--color-line)] bg-[var(--color-surface-2)] px-2 py-1 text-xs outline-none focus:border-[var(--color-accent)]"
          />
          <button
            type="submit"
            className="rounded border border-[var(--color-line)] px-2 py-1 text-xs hover:border-[var(--color-accent)]"
          >
            add
          </button>
        </form>
      </Section>

      {isClassify ? (
        <Section title={`Classifications · ${frameClassificationClassIds.size}`}>
          {!activeFrameId ? (
            <p className="text-xs text-[var(--color-muted)]">이미지를 선택하세요.</p>
          ) : frameClassificationClassIds.size === 0 ? (
            <p className="text-xs text-[var(--color-muted)]">
              상단 클래스 체크박스로 이미지에 클래스를 부여하세요.
            </p>
          ) : (
            <ul className="space-y-1">
              {[...frameClassificationClassIds].map((cid) => {
                const klass = classes.find((c) => c.id === cid);
                if (!klass) return null;
                return (
                  <li
                    key={cid}
                    className="flex items-center gap-2 rounded px-2 py-1.5 text-xs"
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-sm"
                      style={{ background: klass.color }}
                    />
                    <span className="flex-1 truncate">{klass.name}</span>
                    <button
                      type="button"
                      onClick={() =>
                        toggleClassification(activeFrameId, cid)
                      }
                      className="text-[var(--color-muted)] hover:text-[var(--color-danger)]"
                      aria-label="해제"
                    >
                      ×
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
      ) : (
        <Section title={`Annotations · ${frameAnnotations.length}`}>
          {frameAnnotations.length === 0 ? (
            <p className="text-xs text-[var(--color-muted)]">
              Drag on the image to draw a box.
            </p>
          ) : (
            <ul className="space-y-1">
              {frameAnnotations.map((a, idx) => {
                const klass = classes.find((c) => c.id === a.classId);
                const selected = a.id === selectedAnnotationId;
                const isHovered = a.id === hoveredAnnotationId;
                return (
                  <li
                    key={a.id}
                    onMouseEnter={() => setHoveredAnnotationLocal(a.id)}
                    onMouseLeave={() => setHoveredAnnotationLocal(null)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setAnnotCtxMenu({ id: a.id, x: e.clientX, y: e.clientY });
                    }}
                    className={[
                      "group flex items-center gap-2 rounded px-2 py-1.5 text-xs transition",
                      selected
                        ? "bg-[var(--color-accent-soft)]"
                        : isHovered
                          ? "bg-[var(--color-surface-2)] ring-1 ring-[var(--color-accent)]/40"
                          : "hover:bg-[var(--color-surface-2)]",
                    ].join(" ")}
                  >
                    <button
                      type="button"
                      onClick={() => selectAnnotation(a.id)}
                      className="flex flex-1 items-center gap-2 text-left"
                    >
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-sm"
                        style={{ background: klass?.color ?? "#888" }}
                      />
                      <span className="flex-1 truncate">
                        #{idx + 1} · {klass?.name ?? "—"}
                      </span>
                    </button>
                    {segmentingIds[a.id] ? (
                      <span
                        className="shrink-0 text-[10px] text-[var(--color-accent)]"
                        title="Segmenting…"
                      >
                        …seg
                      </span>
                    ) : isHovered ? (
                      <span className="shrink-0 text-[10px] text-[var(--color-muted)]">
                        QWER·H
                      </span>
                    ) : null}
                    <select
                      value={a.classId}
                      onChange={(e) =>
                        updateAnnotation(a.id, { classId: e.target.value })
                      }
                      className="rounded bg-[var(--color-surface-2)] px-1 py-0.5 text-[11px] outline-none"
                    >
                      {classes.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => removeAnnotation(a.id)}
                      className="invisible text-[var(--color-muted)] hover:text-[var(--color-danger)] group-hover:visible"
                    >
                      ×
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
      )}

      <Section title="Shortcuts">
        <ul className="space-y-1 text-xs text-[var(--color-muted)]">
          {isClassify ? (
            <>
              <li><Key>Q</Key><Key>W</Key><Key>E</Key><Key>R</Key> 현재 이미지 클래스 토글</li>
              <li><Key>1</Key> 이전 이미지 · <Key>2</Key> 다음 이미지</li>
              <li>scroll → zoom · dblclick → fit</li>
            </>
          ) : (
            <>
              <li><Key>Q</Key><Key>W</Key><Key>E</Key><Key>R</Key> switch active class</li>
              <li>hover annotation + <Key>Q</Key>–<Key>R</Key> change class</li>
              <li className="flex items-center gap-1.5">
                <span>hover annotation + <Key>H</Key> refine by</span>
                <select
                  value={segmentModel}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (isSegmentModelId(v, segmentModels)) setSegmentModel(v);
                  }}
                  title="Backend segmentation model"
                  className="rounded border border-[var(--color-line)] bg-[var(--color-surface-2)] px-1 py-0.5 text-[11px] text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
                >
                  {segmentModels.map((m) => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
              </li>
              <li><Key>D</Key> delete selected / hovered box</li>
              <li><Key>R</Key> rect tool · <Key>P</Key> polygon tool</li>
              <li>polygon: click vertices; click first vertex or <Key>Enter</Key> to close (≥3 points)</li>
              <li><Key>1</Key> prev image · <Key>2</Key> next image</li>
              <li><Key>C</Key> toggle draw/edit · <Key>Esc</Key> cancel draw</li>
              <li>scroll → zoom · dblclick → fit</li>
            </>
          )}
        </ul>
      </Section>
    </div>

    {annotCtxMenu && (
      <div
        className="fixed z-50 overflow-hidden rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] py-1 shadow-xl text-sm"
        style={{ top: annotCtxMenu.y, left: annotCtxMenu.x }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="block w-full px-4 py-2 text-left text-xs hover:bg-[var(--color-surface-2)]"
          onClick={() => { setBulkAnnotationId(annotCtxMenu.id); setAnnotCtxMenu(null); }}
        >
          일괄 적용…
        </button>
      </div>
    )}

    <BulkApplyTrigger
      annotationId={bulkAnnotationId}
      annotations={annotations}
      classifications={classifications}
      frames={frames}
      exceptedFrameIds={exceptedFrameIds}
      classes={classes}
      addAnnotation={addAnnotation}
      onClose={() => setBulkAnnotationId(null)}
    />
    </>
  );
}

function BulkApplyTrigger({
  annotationId,
  annotations,
  classifications,
  frames,
  exceptedFrameIds,
  classes,
  addAnnotation,
  onClose,
}: {
  annotationId: string | null;
  annotations: ReturnType<typeof useStore.getState>["annotations"];
  classifications: ReturnType<typeof useStore.getState>["classifications"];
  frames: ReturnType<typeof useStore.getState>["frames"];
  exceptedFrameIds: Record<string, boolean>;
  classes: ReturnType<typeof useStore.getState>["classes"];
  addAnnotation: ReturnType<typeof useStore.getState>["addAnnotation"];
  onClose: () => void;
}) {
  if (!annotationId) return null;
  const ann = annotations.find((a) => a.id === annotationId);
  if (!ann) return null;
  return (
    <BulkApplyModal
      annotation={ann}
      frames={frames}
      annotations={annotations}
      classifications={classifications}
      exceptedFrameIds={exceptedFrameIds}
      classes={classes}
      onApply={(imageIds) => {
        for (const imageId of imageIds) {
          if (imageId !== ann.imageId) {
            addAnnotation({ imageId, classId: ann.classId, shape: ann.shape });
          }
        }
      }}
      onClose={onClose}
    />
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b border-[var(--color-line)] p-3">
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted)]">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-[var(--color-line)] bg-[var(--color-surface-2)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--color-text)]">
      {children}
    </kbd>
  );
}
