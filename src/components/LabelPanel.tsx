"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";

export function LabelPanel() {
  const classes = useStore((s) => s.classes);
  const activeClassId = useStore((s) => s.activeClassId);
  const setActiveClass = useStore((s) => s.setActiveClass);
  const addClass = useStore((s) => s.addClass);
  const removeClass = useStore((s) => s.removeClass);
  const renameClass = useStore((s) => s.renameClass);

  const annotations = useStore((s) => s.annotations);
  const activeFrameId = useStore((s) => s.activeFrameId);
  const selectedAnnotationId = useStore((s) => s.selectedAnnotationId);
  const selectAnnotation = useStore((s) => s.selectAnnotation);
  const removeAnnotation = useStore((s) => s.removeAnnotation);
  const updateAnnotation = useStore((s) => s.updateAnnotation);

  const [draftName, setDraftName] = useState("");
  const frameAnnotations = annotations.filter((a) => a.frameId === activeFrameId);

  return (
    <div className="flex h-full w-72 flex-col border-l border-[var(--color-line)] bg-[var(--color-surface)] text-sm">
      <Section title="Classes">
        <ul className="space-y-1">
          {classes.map((c) => {
            const active = c.id === activeClassId;
            return (
              <li
                key={c.id}
                className={[
                  "group flex items-center gap-2 rounded px-2 py-1.5 transition",
                  active
                    ? "bg-[var(--color-accent-soft)]"
                    : "hover:bg-[var(--color-surface-2)]",
                ].join(" ")}
              >
                <button
                  type="button"
                  onClick={() => setActiveClass(c.id)}
                  className="flex flex-1 items-center gap-2 text-left"
                >
                  <span
                    className="h-3.5 w-3.5 rounded-sm"
                    style={{ background: c.color }}
                  />
                  <input
                    value={c.name}
                    onChange={(e) => renameClass(c.id, e.target.value)}
                    className="flex-1 bg-transparent outline-none"
                  />
                </button>
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
              return (
                <li
                  key={a.id}
                  className={[
                    "group flex items-center gap-2 rounded px-2 py-1.5 text-xs",
                    selected
                      ? "bg-[var(--color-accent-soft)]"
                      : "hover:bg-[var(--color-surface-2)]",
                  ].join(" ")}
                >
                  <button
                    type="button"
                    onClick={() => selectAnnotation(a.id)}
                    className="flex flex-1 items-center gap-2 text-left"
                  >
                    <span
                      className="h-2.5 w-2.5 rounded-sm"
                      style={{ background: klass?.color ?? "#888" }}
                    />
                    <span className="flex-1 truncate">
                      #{idx + 1} · {klass?.name ?? "—"}
                    </span>
                  </button>
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

      <Section title="Shortcuts">
        <ul className="space-y-1 text-xs text-[var(--color-muted)]">
          <li>
            <Key>R</Key> rectangle tool
          </li>
          <li>
            <Key>⌫</Key> delete selected box
          </li>
          <li>drag on canvas to draw</li>
          <li>click a box to select</li>
        </ul>
      </Section>
    </div>
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
