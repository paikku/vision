"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  AnnotationStage,
  LabelPanel,
  Toolbar,
  useKeyboardShortcuts,
} from "@/features/annotations";
import { FrameStrip } from "@/features/frames";
import type { Frame } from "@/features/frames/types";
import {
  exportUrl,
  getLabelSet,
  imageUrl,
} from "@/features/projects/service/api";
import { useStore } from "@/lib/store";
import { useReleaseNonTextFocus } from "@/shared/dom/useReleaseNonTextFocus";
import { useLabelSetSync } from "./useLabelSetSync";

export function LabelingWorkspace({
  projectId,
  labelsetId,
}: {
  projectId: string;
  labelsetId: string;
}) {
  const taskType = useStore((s) => s.taskType);
  const [labelsetName, setLabelsetName] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resetRef = useRef(useStore.getState().reset);
  const workspaceRef = useRef<HTMLDivElement | null>(null);

  useKeyboardShortcuts();

  useEffect(() => {
    let cancelled = false;
    setInitialized(false);
    setError(null);
    const reset = resetRef.current;
    reset();

    void (async () => {
      try {
        const { meta, data, images } = await getLabelSet(projectId, labelsetId);
        if (cancelled) return;
        setLabelsetName(meta.name);

        const frames: Frame[] = images.map((im) => ({
          id: im.id,
          resourceId: im.resourceId,
          url: imageUrl(projectId, im.id),
          width: im.width,
          height: im.height,
          timestamp: im.timestamp,
          label: im.name,
        }));

        const classes =
          data.classes.length > 0
            ? data.classes
            : [{ id: "default", name: "object", color: "#5b8cff" }];

        useStore.setState({
          frames,
          activeFrameId: frames[0]?.id ?? null,
          annotations: data.annotations,
          classifications: data.classifications,
          classes,
          activeClassId: classes[0].id,
          taskType: meta.taskType,
          activeToolId:
            meta.taskType === "polygon"
              ? "polygon"
              : meta.taskType === "bbox"
                ? "rect"
                : "rect",
          interactionMode: "draw",
          // Range filter is only meaningful for video-derived images.
          rangeFilterEnabled: false,
          frameRange: null,
        });

        if (!cancelled) setInitialized(true);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "라벨셋 로드 실패");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, labelsetId]);

  useEffect(() => {
    const reset = resetRef.current;
    return () => reset();
  }, []);

  useLabelSetSync({ projectId, labelsetId, initialized });
  useReleaseNonTextFocus(workspaceRef);

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--color-bg)] p-6 text-sm">
        <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-6">
          <div className="mb-2 font-semibold text-[var(--color-danger)]">로드 실패</div>
          <div className="mb-4 text-[var(--color-muted)]">{error}</div>
          <Link
            href={`/projects/${projectId}`}
            className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-xs font-medium text-black"
          >
            프로젝트로 돌아가기
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div ref={workspaceRef} className="flex h-screen flex-col overflow-hidden">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--color-line)] bg-[var(--color-surface)] px-4">
        <div className="flex items-center gap-3">
          <Link
            href={`/projects/${projectId}`}
            className="text-xs text-[var(--color-muted)] hover:text-[var(--color-text)]"
          >
            ← 프로젝트로
          </Link>
          <span className="rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
            {taskType}
          </span>
          <span className="max-w-[40ch] truncate text-sm font-medium">
            {labelsetName ?? "…"}
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <a
            href={exportUrl(projectId, { labelsetIds: [labelsetId] })}
            className="rounded-md border border-[var(--color-line)] px-3 py-1.5 hover:border-[var(--color-accent)]"
          >
            JSON
          </a>
          <span className="text-[var(--color-muted)]">자동 저장됨</span>
        </div>
      </header>

      {initialized ? (
        <div className="flex min-h-0 flex-1">
          <aside className="flex w-72 shrink-0 flex-col border-r border-[var(--color-line)] bg-[var(--color-surface)]">
            <div className="border-b border-[var(--color-line)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
              Images
            </div>
            <FrameStrip />
          </aside>
          {taskType !== "classify" && <Toolbar />}
          <main className="relative min-w-0 flex-1 bg-[var(--color-bg)]">
            <AnnotationStage />
          </main>
          <LabelPanel />
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center text-sm text-[var(--color-muted)]">
          불러오는 중…
        </div>
      )}
    </div>
  );
}
