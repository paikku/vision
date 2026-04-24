"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import {
  Badge,
  Button,
  IconButton,
  Input,
  Kbd,
  Menu,
  MenuItem,
  Select,
  cn,
} from "@/shared/ui";
import { BulkApplyModal } from "./BulkApplyModal";
import type { ClassShortcutKey } from "../types";

const CLASS_SHORTCUT_KEYS: ClassShortcutKey[] = ["q", "w", "e", "r"];
const REMOVE_KEYS = new Set(["d"]);

function isEditableTarget(target: EventTarget | null) {
  if (!target) return false;
  const el = target as HTMLElement;
  if (el.isContentEditable) return true;
  const tag = el.tagName.toLowerCase();
  if (tag === "textarea" || tag === "select") return true;
  if (tag === "input") {
    const type = (el as HTMLInputElement).type.toLowerCase();
    return !["checkbox", "radio", "button", "submit", "reset", "file", "color", "range"].includes(type);
  }
  return false;
}

export function LabelPanel() {
  const classes = useStore((s) => s.classes);
  const activeClassId = useStore((s) => s.activeClassId);
  const setActiveClass = useStore((s) => s.setActiveClass);
  const addClass = useStore((s) => s.addClass);
  const removeClass = useStore((s) => s.removeClass);
  const renameClass = useStore((s) => s.renameClass);
  const setClassShortcut = useStore((s) => s.setClassShortcut);
  const setClassColor = useStore((s) => s.setClassColor);

  const annotations = useStore((s) => s.annotations);
  const frames = useStore((s) => s.frames);
  const activeFrameId = useStore((s) => s.activeFrameId);
  const selectedAnnotationId = useStore((s) => s.selectedAnnotationId);
  const selectAnnotation = useStore((s) => s.selectAnnotation);
  const removeAnnotation = useStore((s) => s.removeAnnotation);
  const updateAnnotation = useStore((s) => s.updateAnnotation);
  const setHoveredAnnotation = useStore((s) => s.setHoveredAnnotation);
  const addAnnotation = useStore((s) => s.addAnnotation);
  const exceptedFrameIds = useStore((s) => s.exceptedFrameIds);

  const [draftName, setDraftName] = useState("");
  const [hoveredClassId, setHoveredClassId] = useState<string | null>(null);
  const hoveredClassIdRef = useRef(hoveredClassId);
  hoveredClassIdRef.current = hoveredClassId;

  const hoveredAnnotationId = useStore((s) => s.hoveredAnnotationId);
  const setHoveredAnnotationLocal = useCallback(
    (id: string | null) => {
      setHoveredAnnotation(id);
    },
    [setHoveredAnnotation],
  );

  const [bulkAnnotationId, setBulkAnnotationId] = useState<string | null>(null);
  const [annotCtxMenu, setAnnotCtxMenu] = useState<{ id: string; x: number; y: number } | null>(null);

  const frameAnnotations = annotations.filter((a) => a.frameId === activeFrameId);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      const key = e.key.toLowerCase();

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

      const hoveredAnnotation = useStore.getState().hoveredAnnotationId;
      if (hoveredAnnotation) {
        if (REMOVE_KEYS.has(key)) {
          e.preventDefault();
          e.stopImmediatePropagation();
          removeAnnotation(hoveredAnnotation);
          setHoveredAnnotationLocal(null);
          return;
        }
        if (CLASS_SHORTCUT_KEYS.includes(key as ClassShortcutKey)) {
          const klass = useStore.getState().classes.find((c) => c.shortcutKey === key);
          if (klass) {
            e.preventDefault();
            e.stopImmediatePropagation();
            updateAnnotation(hoveredAnnotation, { classId: klass.id });
          }
        }
      }
    };
    window.addEventListener("keydown", handler, { capture: true });
    return () => window.removeEventListener("keydown", handler, { capture: true });
  }, [removeAnnotation, setActiveClass, setClassShortcut, setHoveredAnnotationLocal, updateAnnotation]);

  return (
    <>
      <div className="flex h-full w-72 flex-col border-l border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--text-sm)]">
        <Section title="Classes">
          <p className="mb-2 flex flex-wrap items-center gap-1 text-[var(--text-2xs)] text-[var(--color-muted)]">
            Hover a class, press <Kbd>Q</Kbd><Kbd>W</Kbd><Kbd>E</Kbd><Kbd>R</Kbd> to assign shortcut.
          </p>
          <ul className="space-y-1">
            {classes.map((c) => {
              const active = c.id === activeClassId;
              const isHovered = c.id === hoveredClassId;
              return (
                <li
                  key={c.id}
                  onMouseEnter={() => setHoveredClassId(c.id)}
                  onMouseLeave={() => setHoveredClassId(null)}
                  className={cn(
                    "group flex items-center gap-2 rounded-[var(--radius-md)] px-2 py-1.5 transition-colors",
                    active
                      ? "bg-[var(--color-accent-soft)]"
                      : isHovered
                        ? "bg-[var(--color-surface-2)] ring-1 ring-[var(--color-accent)]/40"
                        : "hover:bg-[var(--color-hover)]",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => setActiveClass(c.id)}
                    className="flex flex-1 items-center gap-2 text-left"
                  >
                    <label
                      title="Click to change color"
                      className="h-3.5 w-3.5 shrink-0 cursor-pointer rounded-[var(--radius-xs)] ring-offset-1 transition-shadow hover:ring-2 hover:ring-[var(--color-accent)]"
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
                      className="flex-1 bg-transparent text-[var(--text-sm)] text-[var(--color-text)] outline-none"
                    />
                  </button>

                  <div className="shrink-0">
                    {c.shortcutKey ? (
                      <button
                        type="button"
                        title="Click to clear shortcut"
                        onClick={() => setClassShortcut(c.id, null)}
                        className="flex h-5 w-5 items-center justify-center rounded-[var(--radius-xs)] border border-[var(--color-accent)]/60 bg-[var(--color-accent-soft)] font-mono text-[var(--text-2xs)] text-[var(--color-accent)] transition-colors hover:border-[var(--color-danger)] hover:text-[var(--color-danger)]"
                      >
                        {c.shortcutKey.toUpperCase()}
                      </button>
                    ) : isHovered ? (
                      <span className="flex h-5 w-5 items-center justify-center rounded-[var(--radius-xs)] border border-dashed border-[var(--color-line)] font-mono text-[var(--text-2xs)] text-[var(--color-muted)]">
                        ?
                      </span>
                    ) : null}
                  </div>

                  <button
                    type="button"
                    onClick={() => removeClass(c.id)}
                    className="invisible text-[var(--text-sm)] text-[var(--color-muted)] transition-colors hover:text-[var(--color-danger)] group-hover:visible"
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
            <Input
              size="sm"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              placeholder="new class name"
              className="flex-1"
            />
            <Button type="submit" variant="secondary" size="sm">
              add
            </Button>
          </form>
        </Section>

        <Section title={`Annotations · ${frameAnnotations.length}`}>
          {frameAnnotations.length === 0 ? (
            <p className="text-[var(--text-xs)] text-[var(--color-muted)]">
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
                    className={cn(
                      "group flex items-center gap-2 rounded-[var(--radius-md)] px-2 py-1.5 text-[var(--text-xs)] transition-colors",
                      selected
                        ? "bg-[var(--color-accent-soft)]"
                        : isHovered
                          ? "bg-[var(--color-surface-2)] ring-1 ring-[var(--color-accent)]/40"
                          : "hover:bg-[var(--color-hover)]",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => selectAnnotation(a.id)}
                      className="flex flex-1 items-center gap-2 text-left"
                    >
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-[var(--radius-xs)]"
                        style={{ background: klass?.color ?? "#888" }}
                      />
                      <span className="flex-1 truncate text-[var(--color-text)]">
                        #{idx + 1} · {klass?.name ?? "—"}
                      </span>
                    </button>
                    {isHovered && (
                      <Badge tone="muted" size="xs">
                        QWER→class
                      </Badge>
                    )}
                    <Select
                      size="sm"
                      value={a.classId}
                      onChange={(e) => updateAnnotation(a.id, { classId: e.target.value })}
                      className="h-6 text-[var(--text-2xs)]"
                    >
                      {classes.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </Select>
                    <IconButton
                      label="삭제"
                      size="xs"
                      variant="danger"
                      onClick={() => removeAnnotation(a.id)}
                      className="invisible group-hover:visible"
                      icon={<span aria-hidden>×</span>}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        <Section title="Shortcuts">
          <ul className="space-y-1.5 text-[var(--text-xs)] text-[var(--color-muted)]">
            <li className="flex flex-wrap items-center gap-1"><Kbd>Q</Kbd><Kbd>W</Kbd><Kbd>E</Kbd><Kbd>R</Kbd> switch active class</li>
            <li className="flex flex-wrap items-center gap-1">hover annotation + <Kbd>Q</Kbd>–<Kbd>R</Kbd> change class</li>
            <li className="flex flex-wrap items-center gap-1"><Kbd>D</Kbd> delete selected / hovered box</li>
            <li className="flex flex-wrap items-center gap-1"><Kbd>1</Kbd> prev frame · <Kbd>2</Kbd> next frame</li>
            <li className="flex flex-wrap items-center gap-1"><Kbd>C</Kbd> toggle draw/edit · <Kbd>Esc</Kbd> cancel draw</li>
            <li>scroll → zoom · dblclick → fit</li>
          </ul>
        </Section>
      </div>

      {annotCtxMenu && (
        <Menu
          open
          onClose={() => setAnnotCtxMenu(null)}
          x={annotCtxMenu.x}
          y={annotCtxMenu.y}
        >
          <MenuItem
            onClick={() => {
              setBulkAnnotationId(annotCtxMenu.id);
              setAnnotCtxMenu(null);
            }}
          >
            일괄 적용…
          </MenuItem>
        </Menu>
      )}

      <BulkApplyTrigger
        annotationId={bulkAnnotationId}
        annotations={annotations}
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
  frames,
  exceptedFrameIds,
  classes,
  addAnnotation,
  onClose,
}: {
  annotationId: string | null;
  annotations: ReturnType<typeof useStore.getState>["annotations"];
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
      exceptedFrameIds={exceptedFrameIds}
      classes={classes}
      onApply={(frameIds) => {
        for (const frameId of frameIds) {
          if (frameId !== ann.frameId) {
            addAnnotation({ frameId, classId: ann.classId, shape: ann.shape });
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
      <h3 className="mb-2 text-[var(--text-2xs)] font-semibold uppercase tracking-wider text-[var(--color-muted)]">
        {title}
      </h3>
      {children}
    </section>
  );
}
