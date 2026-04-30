"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AnnotationStage } from "@/features/annotations/ui/AnnotationStage";
import { LabelPanel } from "@/features/annotations/ui/LabelPanel";
import { Toolbar } from "@/features/annotations/ui/Toolbar";
import { useKeyboardShortcuts } from "@/features/annotations/hooks/useKeyboardShortcuts";
import type { Annotation, LabelClass } from "@/features/annotations/types";
import { FrameStrip } from "@/features/frames/ui/FrameStrip";
import type { Frame } from "@/features/frames/types";
import {
  imageBytesUrl,
  listImages,
} from "@/features/images/service/api";
import type { Image } from "@/features/images/types";
import {
  getLabelSet,
  getLabelSetAnnotations,
  labelSetExportUrl,
} from "@/features/labelsets/service/api";
import type { LabelSet } from "@/features/labelsets/types";
import { useStore } from "@/lib/store";
import { useReleaseNonTextFocus } from "@/shared/dom/useReleaseNonTextFocus";
import { annotationFromApi, useLabelSetSync } from "./useLabelSetSync";

const DEFAULT_PALETTE = [
  "#5b8cff",
  "#ffb35b",
  "#5bff9c",
  "#ff5bd1",
  "#ffe45b",
  "#5bf2ff",
  "#a35bff",
  "#ff8a5b",
];

export function LabelingWorkspace({
  projectId,
  labelSetId,
}: {
  projectId: string;
  labelSetId: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [labelSet, setLabelSet] = useState<LabelSet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  const reset = useStore((s) => s.reset);

  // Hydrate the workspace from server state when the LabelSet id changes.
  useEffect(() => {
    let cancelled = false;
    setHydrated(false);
    reset();
    (async () => {
      try {
        const [ls, annData] = await Promise.all([
          getLabelSet(projectId, labelSetId),
          getLabelSetAnnotations(projectId, labelSetId),
        ]);
        if (cancelled) return;

        // Pull only the images that belong to this LabelSet.
        const allImages = await listImages(projectId);
        if (cancelled) return;
        const idSet = new Set(ls.imageIds);
        const images = allImages.filter((i) => idSet.has(i.id));
        const orderById = new Map(ls.imageIds.map((id, i) => [id, i] as const));
        images.sort(
          (a, b) =>
            (orderById.get(a.id) ?? 0) - (orderById.get(b.id) ?? 0),
        );

        const frames: Frame[] = images.map((img) => imageToFrame(img, projectId));
        const classes: LabelClass[] =
          ls.classes.length > 0
            ? ls.classes
            : [
                {
                  id: cryptoId(),
                  name: "object",
                  color: DEFAULT_PALETTE[0],
                },
              ];
        const annotations: Annotation[] = annData.annotations.map(
          annotationFromApi,
        );

        // The drawing pipeline picks its tool based on the LabelSet type:
        //   bbox     → rect
        //   polygon  → polygon
        //   classify → classify (drawing pipeline is gated off — clicks
        //              instead apply the active class to the active image)
        const initialTool =
          ls.type === "bbox"
            ? "rect"
            : ls.type === "polygon"
              ? "polygon"
              : "classify";

        useStore.setState({
          frames,
          activeFrameId: frames[0]?.id ?? null,
          classes,
          activeClassId: classes[0]?.id ?? null,
          annotations,
          selectedAnnotationId: null,
          hoveredAnnotationId: null,
          activeToolId: initialTool,
          interactionMode: "draw",
          // Range/exception filters are video-time concepts that don't
          // apply in the labeling workspace. Keep them in their disabled
          // state so the FrameStrip stays an unfiltered list.
          exceptedFrameIds: {},
          unlabeledOnly: false,
          rangeFilterEnabled: false,
          frameRange: null,
          labelSetType: ls.type,
        });
        setLabelSet(ls);
        setHydrated(true);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "LabelSet 로드 실패");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // setActiveTool is stable; reset is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, labelSetId]);

  // Server sync (downloads happen above; this owns uploads).
  useLabelSetSync({ projectId, labelSetId, ready: hydrated });

  // Auto-blur stray focus from interactive widgets so global shortcuts work
  // without users having to click out of a control first.
  useReleaseNonTextFocus(rootRef);

  // Global shortcuts (D delete, Q/W/E/R class, 1/2 frame nav, C draw/edit, R/P tools).
  useKeyboardShortcuts();

  // Cleanup on unmount: drop store state. The store still holds non-blob URLs
  // here so the revoke path is a no-op — reset() is just bookkeeping.
  useEffect(() => {
    return () => reset();
  }, [reset]);

  return (
    <div ref={rootRef} className="flex h-screen flex-col bg-[var(--color-bg)]">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-[var(--color-line)] bg-[var(--color-surface)] px-4">
        <Link
          href={`/projects/${projectId}/labelsets`}
          className="text-xs text-[var(--color-muted)] hover:text-[var(--color-accent)]"
        >
          ← LabelSets
        </Link>
        <div className="text-sm font-semibold tracking-tight">
          {labelSet?.name ?? (error ? "(error)" : "Loading…")}
        </div>
        {labelSet && (
          <span className="rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
            {labelSet.type}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2 text-xs">
          {labelSet && (
            <a
              href={labelSetExportUrl(projectId, labelSet.id)}
              download={`${labelSet.name}.json`}
              className="rounded-md border border-[var(--color-line)] px-2.5 py-1 text-[var(--color-muted)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
            >
              Export JSON
            </a>
          )}
          <Link
            href={`/projects/${projectId}`}
            className="text-[var(--color-muted)] hover:text-[var(--color-accent)]"
          >
            Media Library
          </Link>
        </div>
      </header>

      {error && (
        <div className="border-b border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-4 py-2 text-xs text-[var(--color-danger)]">
          {error}
        </div>
      )}

      {!hydrated && !error ? (
        <div className="grid flex-1 place-items-center text-sm text-[var(--color-muted)]">
          불러오는 중…
        </div>
      ) : (
        <div className="flex flex-1 overflow-hidden">
          <FrameStrip />
          <Toolbar />
          <div className="relative flex-1 overflow-hidden">
            <AnnotationStage />
          </div>
          <LabelPanel />
        </div>
      )}
    </div>
  );
}

function imageToFrame(img: Image, projectId: string): Frame {
  return {
    id: img.id,
    mediaId: img.resourceId,
    url: imageBytesUrl(projectId, img.id),
    width: img.width,
    height: img.height,
    timestamp: img.videoFrameMeta?.timestamp,
    label: img.fileName,
  };
}

function cryptoId(): string {
  return globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
}
