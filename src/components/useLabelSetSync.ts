"use client";

import { useEffect, useRef } from "react";
import { useStore } from "@/lib/store";
import {
  saveLabelSetAnnotations,
  updateLabelSet,
} from "@/features/labelsets/service/api";
import type {
  ClassifyAnnotation,
  LabelClass as ApiLabelClass,
  LabelSetAnnotation,
  PolygonAnnotation,
  RectAnnotation,
  ShapePolygon,
  ShapeRect,
} from "@/features/labelsets/types";
import type { Annotation } from "@/features/annotations/types";

const DEBOUNCE_MS = 500;

/**
 * Server sync for the labeling workspace:
 *
 * 1. Debounced save of {@link Annotation}[] to the LabelSet's annotations.json.
 * 2. Debounced save of {@link LabelClass}[] to the LabelSet meta (PATCH).
 *
 * Hydration (initial download + store wiring) is performed by the workspace
 * shell on mount; this hook only owns the upload side. The sync is keyed to
 * `[projectId, labelSetId]`; switching LabelSets cancels any pending writes
 * tied to the previous context via a generation counter, so an in-flight
 * save can never clobber a newly-loaded LabelSet's data.
 */
export function useLabelSetSync({
  projectId,
  labelSetId,
  ready,
}: {
  projectId: string;
  labelSetId: string;
  /** Set true once the workspace has hydrated; only then should we save. */
  ready: boolean;
}) {
  const annotations = useStore((s) => s.annotations);
  const classes = useStore((s) => s.classes);
  const annTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const classesTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generationRef = useRef(0);

  // Bump generation when the target LabelSet changes; pending writes from
  // the previous context detect the change and bail before mutating.
  useEffect(() => {
    generationRef.current += 1;
    if (annTimerRef.current) clearTimeout(annTimerRef.current);
    if (classesTimerRef.current) clearTimeout(classesTimerRef.current);
    annTimerRef.current = null;
    classesTimerRef.current = null;
  }, [projectId, labelSetId]);

  useEffect(() => {
    if (!ready) return;
    const gen = generationRef.current;
    if (annTimerRef.current) clearTimeout(annTimerRef.current);
    annTimerRef.current = setTimeout(() => {
      if (gen !== generationRef.current) return;
      const payload = annotations
        .map(annotationToApi)
        .filter((x): x is LabelSetAnnotation => x !== null);
      void saveLabelSetAnnotations(projectId, labelSetId, {
        annotations: payload,
      }).catch(() => {
        // Best-effort; the next debounce will retry.
      });
    }, DEBOUNCE_MS);
    return () => {
      if (annTimerRef.current) clearTimeout(annTimerRef.current);
    };
  }, [annotations, ready, projectId, labelSetId]);

  useEffect(() => {
    if (!ready) return;
    const gen = generationRef.current;
    if (classesTimerRef.current) clearTimeout(classesTimerRef.current);
    classesTimerRef.current = setTimeout(() => {
      if (gen !== generationRef.current) return;
      const payload: ApiLabelClass[] = classes.map((c) => ({
        id: c.id,
        name: c.name,
        color: c.color,
        shortcutKey: c.shortcutKey,
      }));
      void updateLabelSet(projectId, labelSetId, { classes: payload }).catch(
        () => {},
      );
    }, DEBOUNCE_MS);
    return () => {
      if (classesTimerRef.current) clearTimeout(classesTimerRef.current);
    };
  }, [classes, ready, projectId, labelSetId]);
}

// ---------- store ↔ API conversion helpers ----------

export function annotationFromApi(a: LabelSetAnnotation): Annotation {
  if (a.kind === "rect") {
    const s: ShapeRect = a.shape;
    return {
      id: a.id,
      frameId: a.imageId,
      classId: a.classId,
      kind: "rect",
      shape: { kind: "rect", x: s.x, y: s.y, w: s.w, h: s.h },
      createdAt: a.createdAt,
    };
  }
  if (a.kind === "polygon") {
    const s: ShapePolygon = a.shape;
    return {
      id: a.id,
      frameId: a.imageId,
      classId: a.classId,
      kind: "polygon",
      shape: { kind: "polygon", rings: s.rings },
      createdAt: a.createdAt,
    };
  }
  return {
    id: a.id,
    frameId: a.imageId,
    classId: a.classId,
    kind: "classify",
    createdAt: a.createdAt,
  };
}

function annotationToApi(a: Annotation): LabelSetAnnotation | null {
  if (a.kind === "rect") {
    if (a.shape?.kind !== "rect") return null;
    const out: RectAnnotation = {
      id: a.id,
      imageId: a.frameId,
      classId: a.classId,
      kind: "rect",
      shape: a.shape,
      createdAt: a.createdAt,
    };
    return out;
  }
  if (a.kind === "polygon") {
    if (a.shape?.kind !== "polygon") return null;
    const out: PolygonAnnotation = {
      id: a.id,
      imageId: a.frameId,
      classId: a.classId,
      kind: "polygon",
      shape: a.shape,
      createdAt: a.createdAt,
    };
    return out;
  }
  const out: ClassifyAnnotation = {
    id: a.id,
    imageId: a.frameId,
    classId: a.classId,
    kind: "classify",
    createdAt: a.createdAt,
  };
  return out;
}
