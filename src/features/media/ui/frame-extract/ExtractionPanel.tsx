"use client";

import { useMemo, useState, type ReactNode } from "react";

export type ExtractPanelActions = {
  interval: number;
  setInterval: (value: number) => void;
  busy: boolean;
  captureCurrent: () => Promise<void>;
  captureEvenly: () => Promise<void>;
};

type ExtractTab = {
  id: string;
  label: string;
  render: (actions: ExtractPanelActions) => ReactNode;
};

export function ExtractionPanel(actions: ExtractPanelActions) {
  const tabs = useMemo<ExtractTab[]>(
    () => [
      {
        id: "quick",
        label: "Quick",
        render: (a) => (
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={a.busy}
              onClick={() => void a.captureCurrent()}
              className="rounded-md bg-[var(--color-accent)] px-3 py-2 text-sm font-medium text-black disabled:opacity-50"
            >
              Capture this frame (C)
            </button>
            <div className="flex items-center gap-2 rounded-md border border-[var(--color-line)] px-2 py-1 text-xs text-[var(--color-muted)]">
              <span>every</span>
              <input
                type="number"
                min={1}
                max={64}
                value={a.interval}
                onChange={(e) => a.setInterval(Math.max(1, Number(e.target.value) || 1))}
                className="w-12 rounded bg-[var(--color-surface-2)] px-1 py-0.5 text-center text-[var(--color-text)] outline-none"
              />
              <button
                type="button"
                disabled={a.busy}
                onClick={() => void a.captureEvenly()}
                className="ml-auto rounded bg-[var(--color-surface-2)] px-2 py-1 text-[var(--color-text)] hover:bg-[var(--color-line)] disabled:opacity-50"
              >
                Sample
              </button>
            </div>
          </div>
        ),
      },
      {
        id: "range",
        label: "Range",
        render: () => (
          <div className="rounded-md border border-dashed border-[var(--color-line)] px-3 py-2 text-xs text-[var(--color-muted)]">
            Range extraction preset slot (start/end/step) — reserved for next iteration.
          </div>
        ),
      },
      {
        id: "smart",
        label: "Smart",
        render: () => (
          <div className="rounded-md border border-dashed border-[var(--color-line)] px-3 py-2 text-xs text-[var(--color-muted)]">
            Smart extraction preset slot (keyframes/scene change) — reserved for next iteration.
          </div>
        ),
      },
    ],
    [],
  );

  const [activeTab, setActiveTab] = useState(tabs[0].id);
  const current = tabs.find((tab) => tab.id === activeTab) ?? tabs[0];

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1">
        {tabs.map((tab) => {
          const active = tab.id === current.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={[
                "rounded px-2 py-1 text-xs",
                active
                  ? "bg-[var(--color-accent)] text-black"
                  : "bg-[var(--color-surface-2)] text-[var(--color-text)] hover:bg-[var(--color-line)]",
              ].join(" ")}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {current.render(actions)}
    </div>
  );
}
