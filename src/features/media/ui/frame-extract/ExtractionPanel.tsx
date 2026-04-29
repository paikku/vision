"use client";

import { useMemo, useState, type ReactNode } from "react";
import { formatTime } from "../../service/capture";

export type ExtractPanelActions = {
  /** Quick: 전체 N등분 - input. */
  interval: number;
  setInterval: (value: number) => void;
  busy: boolean;
  captureCurrent: () => Promise<void>;
  captureEvenly: () => Promise<void>;
  /** Active range in seconds, or null when none is set. */
  range: { start: number; end: number } | null;
  /** Range-aware actions. Implemented in VideoFramePicker. */
  captureRangeEvenly: (count: number) => Promise<void>;
  captureRangeMaxCount: (max: number) => Promise<void>;
  removeRangeFrames: () => void;
  /** How many existing frames sit inside the current range (for the delete button). */
  rangeFrameCount: number;
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
        render: (a) => <RangeTabContent actions={a} />,
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

function RangeTabContent({ actions }: { actions: ExtractPanelActions }) {
  const [count, setCount] = useState(8);
  const [maxCount, setMaxCount] = useState(20);
  const range = actions.range;

  if (!range) {
    return (
      <div className="rounded-md border border-dashed border-[var(--color-line)] px-3 py-2 text-xs text-[var(--color-muted)]">
        타임라인 아래의 Range 트랙에서 시작/끝 핸들을 드래그해 범위를 설정하세요.
      </div>
    );
  }

  const span = Math.max(0, range.end - range.start);

  const onDelete = () => {
    if (actions.rangeFrameCount === 0) return;
    const ok = window.confirm(
      `현재 범위(${formatTime(range.start)} ~ ${formatTime(range.end)})에 있는 프레임 ${actions.rangeFrameCount}개를 삭제할까요?`,
    );
    if (ok) actions.removeRangeFrames();
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between rounded-md border border-[var(--color-line)] px-2 py-1 text-[11px] text-[var(--color-muted)]">
        <span>
          범위 <span className="text-[var(--color-text)] tabular-nums">{formatTime(range.start)} ~ {formatTime(range.end)}</span>
          <span className="ml-2">({span.toFixed(2)}s)</span>
        </span>
        <span className="tabular-nums">기존 {actions.rangeFrameCount}개</span>
      </div>

      <div className="flex items-center gap-2 rounded-md border border-[var(--color-line)] px-2 py-1 text-xs text-[var(--color-muted)]">
        <span>N등분</span>
        <input
          type="number"
          min={1}
          max={500}
          value={count}
          onChange={(e) => setCount(Math.max(1, Number(e.target.value) || 1))}
          className="w-14 rounded bg-[var(--color-surface-2)] px-1 py-0.5 text-center text-[var(--color-text)] outline-none"
        />
        <span className="tabular-nums">{count > 0 ? `≈ ${(span / (count + 1)).toFixed(2)}s 간격` : ""}</span>
        <button
          type="button"
          disabled={actions.busy || span <= 0}
          onClick={() => void actions.captureRangeEvenly(count)}
          className="ml-auto rounded bg-[var(--color-surface-2)] px-2 py-1 text-[var(--color-text)] hover:bg-[var(--color-line)] disabled:opacity-50"
        >
          캡처
        </button>
      </div>

      <div className="flex items-center gap-2 rounded-md border border-[var(--color-line)] px-2 py-1 text-xs text-[var(--color-muted)]">
        <span>최대</span>
        <input
          type="number"
          min={1}
          max={500}
          value={maxCount}
          onChange={(e) => setMaxCount(Math.max(1, Number(e.target.value) || 1))}
          className="w-14 rounded bg-[var(--color-surface-2)] px-1 py-0.5 text-center text-[var(--color-text)] outline-none"
        />
        <span>개로 균등</span>
        <button
          type="button"
          disabled={actions.busy || span <= 0}
          onClick={() => void actions.captureRangeMaxCount(maxCount)}
          className="ml-auto rounded bg-[var(--color-surface-2)] px-2 py-1 text-[var(--color-text)] hover:bg-[var(--color-line)] disabled:opacity-50"
        >
          캡처
        </button>
      </div>

      <button
        type="button"
        disabled={actions.rangeFrameCount === 0}
        onClick={onDelete}
        className="w-full rounded-md border border-red-500/40 bg-red-500/10 px-2 py-1 text-xs text-red-400 hover:bg-red-500/20 disabled:opacity-40"
      >
        범위 내 프레임 {actions.rangeFrameCount}개 삭제
      </button>
    </div>
  );
}
