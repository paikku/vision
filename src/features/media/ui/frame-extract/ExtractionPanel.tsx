"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Button, Input, SegmentedControl } from "@/shared/ui";

export type ExtractPanelActions = {
  interval: number;
  setInterval: (value: number) => void;
  busy: boolean;
  captureCurrent: () => Promise<void>;
  captureEvenly: () => Promise<void>;
};

type ExtractTabId = "quick" | "range" | "smart";

type ExtractTab = {
  id: ExtractTabId;
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
            <Button
              variant="primary"
              size="md"
              disabled={a.busy}
              onClick={() => void a.captureCurrent()}
              block
            >
              Capture this frame (C)
            </Button>
            <div className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface-2)] px-2 py-1 text-[var(--text-xs)] text-[var(--color-muted)]">
              <span>every</span>
              <Input
                size="sm"
                type="number"
                min={1}
                max={64}
                value={a.interval}
                onChange={(e) =>
                  a.setInterval(Math.max(1, Number(e.target.value) || 1))
                }
                className="h-6 w-12 text-center"
              />
              <Button
                variant="subtle"
                size="xs"
                disabled={a.busy}
                onClick={() => void a.captureEvenly()}
                className="ml-auto"
              >
                Sample
              </Button>
            </div>
          </div>
        ),
      },
      {
        id: "range",
        label: "Range",
        render: () => (
          <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-line)] px-3 py-2 text-[var(--text-xs)] text-[var(--color-muted)]">
            Range extraction preset slot (start/end/step) — reserved for next iteration.
          </div>
        ),
      },
      {
        id: "smart",
        label: "Smart",
        render: () => (
          <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-line)] px-3 py-2 text-[var(--text-xs)] text-[var(--color-muted)]">
            Smart extraction preset slot (keyframes/scene change) — reserved for next iteration.
          </div>
        ),
      },
    ],
    [],
  );

  const [activeTab, setActiveTab] = useState<ExtractTabId>(tabs[0].id);
  const current = tabs.find((tab) => tab.id === activeTab) ?? tabs[0];

  return (
    <div className="space-y-2">
      <SegmentedControl<ExtractTabId>
        size="sm"
        value={activeTab}
        onChange={setActiveTab}
        options={tabs.map((t) => ({ value: t.id, label: t.label }))}
        aria-label="추출 프리셋"
      />
      {current.render(actions)}
    </div>
  );
}
