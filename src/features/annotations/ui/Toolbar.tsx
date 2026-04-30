"use client";

import { useStore } from "@/lib/store";
import { TOOLS, TOOL_LIST } from "../tools/registry";
import type { ToolId } from "../types";

/**
 * Tool palette. The LabelSet's `type` fixes which tool is active — the user
 * cannot pick a different one. We render the locked tool as a visible (but
 * non-interactive) badge so the workspace still shows what kind of LabelSet
 * is in scope, and which keyboard hotkey applies.
 */
export function Toolbar() {
  const activeToolId = useStore((s) => s.activeToolId);
  const labelSetType = useStore((s) => s.labelSetType);

  // The Toolbar is shape-tool only — for classify there is nothing to pick.
  if (labelSetType === "classify") return null;

  // Map the LabelSet type → the single allowed tool so the badge below
  // always matches what the LabelSet says, even if `activeToolId` drifts.
  const lockedToolId: ToolId | null =
    labelSetType === "bbox"
      ? "rect"
      : labelSetType === "polygon"
        ? "polygon"
        : null;
  const tool = lockedToolId ? TOOLS[lockedToolId] : null;
  const renderList = tool
    ? [tool]
    : TOOL_LIST.filter((t) => t.id !== "classify" && t.id !== "mask");

  return (
    <div className="flex flex-col items-center gap-1 border-r border-[var(--color-line)] bg-[var(--color-surface)] px-1.5 py-3">
      {renderList.map((t) => {
        const active = t.id === activeToolId;
        return (
          <div
            key={t.id}
            aria-disabled
            title={`${t.name}${t.shortcut ? ` (${t.shortcut})` : ""} · LabelSet 타입에 따라 고정`}
            className={[
              "flex h-10 w-10 items-center justify-center rounded-md text-[var(--color-muted)]",
              "cursor-not-allowed",
              active
                ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                : "opacity-60",
            ].join(" ")}
          >
            <ToolIcon id={t.id as ToolId} />
          </div>
        );
      })}
    </div>
  );
}

function ToolIcon({ id }: { id: ToolId }) {
  if (id === "rect") {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <rect x="4.5" y="6" width="15" height="12" rx="1.5" />
      </svg>
    );
  }
  if (id === "polygon") {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
        <path d="M12 4l8 5-3 10H7L4 9z" />
      </svg>
    );
  }
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M5 17c2-6 4-9 7-9 4 0 6 4 6 6 0 3-2 4-4 4-3 0-3-3-1-3 2 0 2 3-1 3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
