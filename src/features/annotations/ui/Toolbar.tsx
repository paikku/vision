"use client";

import { useStore } from "@/lib/store";
import { TOOL_LIST } from "../tools/registry";
import type { ToolId } from "../types";

// Keyboard shortcuts for tools are handled by useKeyboardShortcuts (Workspace).

export function Toolbar() {
  const activeToolId = useStore((s) => s.activeToolId);
  const setActiveTool = useStore((s) => s.setActiveTool);
  const labelSetType = useStore((s) => s.labelSetType);

  // The Toolbar is shape-tool only — for classify there is nothing to pick.
  if (labelSetType === "classify") return null;

  return (
    <div className="flex flex-col items-center gap-1 border-r border-[var(--color-line)] bg-[var(--color-surface)] px-1.5 py-3">
      {TOOL_LIST.filter((t) => t.id !== "classify").map((tool) => {
        const active = tool.id === activeToolId;
        return (
          <button
            type="button"
            key={tool.id}
            disabled={tool.disabled}
            onClick={() => setActiveTool(tool.id as ToolId)}
            title={`${tool.name}${tool.shortcut ? ` (${tool.shortcut})` : ""}${tool.disabled ? " · coming soon" : ""}`}
            className={[
              "flex h-10 w-10 items-center justify-center rounded-md text-[var(--color-muted)] transition",
              tool.disabled
                ? "cursor-not-allowed opacity-40"
                : active
                  ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                  : "hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]",
            ].join(" ")}
          >
            <ToolIcon id={tool.id as ToolId} />
          </button>
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
